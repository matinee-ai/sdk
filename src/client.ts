/**
 * The Matinee AI TypeScript client — a reference implementation of the seven
 * capabilities Phase 9 §33 requires of every SDK, written against the v1
 * specification. No server serves the API yet; the test suite exercises this
 * client against a mock `fetch`, which is exactly the boundary a real server
 * will occupy.
 *
 * Behaviour is taken from the specification, not invented:
 *   - Base URLs per environment ........................ §3
 *   - The six request headers .......................... §4
 *   - The { data, meta } envelope ...................... §5
 *   - The error envelope and registry .................. §6
 *   - Cursor pagination (never offset) ................. §25
 *   - Rate limit headers on every response ............. §29
 *   - Retry only where retrying is correct ............. the error registry's
 *     own guidance: rate_limit_exceeded and 5xx, nothing else.
 */

import { MatineeApiError, MatineeConnectionError } from './errors.ts'
import type {
  ApiErrorBody,
  ApiResult,
  ArgsFor,
  ElementOf,
  DataOf,
  HttpMethod,
  ListPath,
  OpFor,
  PathsWith,
  RateLimitState,
} from './types.ts'

export const SDK_VERSION = '0.1.0'

/** §3 — one base URL per environment. Regional endpoints are future, not built. */
export const BASE_URLS = {
  production: 'https://api.matinee.ai/v1',
  sandbox: 'https://sandbox-api.matinee.ai/v1',
} as const

export type Environment = keyof typeof BASE_URLS

export type ClientConfig = {
  /** Bearer credential — an API key for systems, a session token for people. */
  apiKey: string
  /** §4 X-Organization-ID — validated server-side against the principal's memberships. */
  organizationId: string
  /** §4 X-Environment. Defaults to sandbox: nothing should touch production by accident. */
  environment?: Environment
  /** Override the derived base URL — for a local mock or a test server. */
  baseUrl?: string
  /** Total attempts per request, including the first. Default 3. */
  maxAttempts?: number
  /** Injectable transport, so tests need no network. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
  /** Injectable delay, so retry timing is observable in tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function readRateLimit(headers: Headers): RateLimitState {
  const num = (name: string) => {
    const raw = headers.get(name)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  return {
    limit: num('RateLimit-Limit'),
    remaining: num('RateLimit-Remaining'),
    reset: num('RateLimit-Reset'),
  }
}

/** Substitute `{param}` tokens. Throws on a missing parameter rather than sending a literal brace. */
function buildPath(template: string, params: Record<string, string> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name]
    if (value === undefined) throw new TypeError(`Missing path parameter "${name}" for ${template}`)
    return encodeURIComponent(value)
  })
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export class MatineeClient {
  readonly baseUrl: string
  readonly environment: Environment
  private readonly config: Required<Pick<ClientConfig, 'apiKey' | 'organizationId' | 'maxAttempts'>>
  private readonly transport: typeof globalThis.fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(config: ClientConfig) {
    if (!config.apiKey) throw new TypeError('apiKey is required')
    if (!config.organizationId) throw new TypeError('organizationId is required')
    this.environment = config.environment ?? 'sandbox'
    this.baseUrl = config.baseUrl ?? BASE_URLS[this.environment]
    this.config = {
      apiKey: config.apiKey,
      organizationId: config.organizationId,
      maxAttempts: config.maxAttempts ?? 3,
    }
    this.transport = config.fetch ?? globalThis.fetch
    this.sleep = config.sleep ?? defaultSleep
  }

  get<P extends PathsWith<'get'>>(path: P, ...args: ArgsFor<OpFor<P, 'get'>>) {
    return this.request('get', path as string, args[0] as never) as Promise<ApiResult<OpFor<P, 'get'>>>
  }

  post<P extends PathsWith<'post'>>(path: P, ...args: ArgsFor<OpFor<P, 'post'>>) {
    return this.request('post', path as string, args[0] as never) as Promise<ApiResult<OpFor<P, 'post'>>>
  }

  patch<P extends PathsWith<'patch'>>(path: P, ...args: ArgsFor<OpFor<P, 'patch'>>) {
    return this.request('patch', path as string, args[0] as never) as Promise<ApiResult<OpFor<P, 'patch'>>>
  }

  put<P extends PathsWith<'put'>>(path: P, ...args: ArgsFor<OpFor<P, 'put'>>) {
    return this.request('put', path as string, args[0] as never) as Promise<ApiResult<OpFor<P, 'put'>>>
  }

  delete<P extends PathsWith<'delete'>>(path: P, ...args: ArgsFor<OpFor<P, 'delete'>>) {
    return this.request('delete', path as string, args[0] as never) as Promise<ApiResult<OpFor<P, 'delete'>>>
  }

  /**
   * §25 — iterate a collection across pages. Cursor in, next_cursor out, until
   * has_more is false. There is no offset variant because the API has none.
   */
  async *paginate<P extends ListPath>(
    path: P,
    ...args: ArgsFor<OpFor<P, 'get'>>
  ): AsyncGenerator<ElementOf<DataOf<OpFor<P, 'get'>>>, void, undefined> {
    const options = (args[0] ?? {}) as { query?: Record<string, unknown> } & Record<string, unknown>
    let cursor: string | undefined
    for (;;) {
      const result = await this.request('get', path as string, {
        ...options,
        query: { ...options.query, ...(cursor ? { cursor } : {}) },
      } as never)
      const items = (result.data ?? []) as ElementOf<DataOf<OpFor<P, 'get'>>>[]
      yield* items
      const meta = result.meta as { next_cursor?: string | null; has_more?: boolean } | undefined
      if (!meta?.has_more || !meta.next_cursor) return
      cursor = meta.next_cursor
    }
  }

  private async request(
    method: HttpMethod,
    template: string,
    options?: {
      path?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
      idempotencyKey?: string
      requestId?: string
      signal?: AbortSignal
    },
  ): Promise<{ data: unknown; meta: unknown; requestId: string; rateLimit: RateLimitState }> {
    const url = this.baseUrl + buildPath(template, options?.path) + buildQuery(options?.query)
    const requestId = options?.requestId ?? crypto.randomUUID()

    // §4 — the six headers. Four always on an authenticated call, two conditional.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-Organization-ID': this.config.organizationId,
      'X-Environment': this.environment,
      'X-Request-ID': requestId,
      'X-SDK-Version': `matinee-sdk-typescript/${SDK_VERSION}`,
    }
    if (options?.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    // Retrying a write that carries no Idempotency-Key risks applying it
    // twice, so only reads and keyed writes are retried after a network
    // failure or a 5xx. A 429 was never processed and is always retryable.
    const safeToRetry = method === 'get' || options?.idempotencyKey !== undefined

    let lastError: unknown
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await this.attempt(method, url, headers, options?.body, options?.signal)
      } catch (error) {
        lastError = error
        const isLast = attempt === this.config.maxAttempts
        if (isLast || !this.shouldRetry(error, safeToRetry)) throw error
        await this.sleep(this.retryDelay(error, attempt))
      }
    }
    throw lastError // unreachable; satisfies control flow
  }

  private shouldRetry(error: unknown, safeToRetry: boolean): boolean {
    if (error instanceof MatineeApiError) {
      if (error.type === 'rate_limit_error') return true
      return error.type === 'service_error' && safeToRetry
    }
    if (error instanceof MatineeConnectionError) return safeToRetry
    return false
  }

  private retryDelay(error: unknown, attempt: number): number {
    // §29 — RateLimit-Reset is authoritative when the server sent it.
    if (error instanceof MatineeApiError && error.type === 'rate_limit_error') {
      const reset = error.rateLimit.reset
      if (reset !== undefined) return Math.min(reset * 1000, 30_000)
    }
    return Math.min(500 * 2 ** (attempt - 1), 8_000)
  }

  private async attempt(
    method: HttpMethod,
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal | undefined,
  ) {
    let response: Response
    try {
      response = await this.transport(url, {
        method: method.toUpperCase(),
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      })
    } catch (cause) {
      throw new MatineeConnectionError(`Request to ${url} failed before a response arrived`, cause)
    }

    const rateLimit = readRateLimit(response.headers)

    if (response.status === 204) {
      return { data: undefined, meta: undefined, requestId: headers['X-Request-ID'], rateLimit }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (cause) {
      throw new MatineeConnectionError(
        `Response from ${url} (${response.status}) was not the { data, meta } envelope`,
        cause,
      )
    }

    if (!response.ok) {
      const envelope = payload as Partial<ApiErrorBody> & { meta?: { request_id?: string } }
      if (envelope?.error?.code && envelope.error.type && envelope.error.message) {
        throw new MatineeApiError(envelope.error, response.status, rateLimit)
      }
      throw new MatineeConnectionError(
        `Response from ${url} (${response.status}) did not carry the §6 error envelope`,
      )
    }

    const success = payload as { data?: unknown; meta?: { request_id?: string } }
    return {
      data: success.data,
      meta: success.meta,
      requestId: success.meta?.request_id ?? headers['X-Request-ID'],
      rateLimit,
    }
  }
}
