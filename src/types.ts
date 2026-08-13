/**
 * Type extraction over the generated OpenAPI definitions.
 *
 * Everything here derives from `api/matinee.d.ts`, which openapi-typescript
 * generates from `api/openapi.json`. Nothing is hand-declared: if an endpoint
 * is not in the document, no type below can name it, which is the compile-time
 * half of "the SDK cannot describe an endpoint that does not exist".
 *
 * Resource bodies are deliberately loose (`Resource` is an open record) because
 * the specification pins concrete shapes down per endpoint as the
 * implementation lands. What is precise today — paths, methods, path and query
 * parameters, the envelope, and the full error-code union — is extracted
 * precisely.
 */

import type { components, paths } from '../api/matinee.d.ts'

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'

/** The paths that define the given method — '/customers' for 'get', etc. */
export type PathsWith<M extends HttpMethod> = {
  [P in keyof paths]: [NonNullable<paths[P][M]>] extends [never] ? never : P
}[keyof paths]

/** The operation object for a path and method. */
export type OpFor<P extends keyof paths, M extends HttpMethod> = NonNullable<paths[P][M]>

/** §6 — the error envelope, with the full registered code union. */
export type ApiErrorBody = components['schemas']['Error']
export type ApiErrorInfo = ApiErrorBody['error']
export type ErrorType = ApiErrorInfo['type']
export type ErrorCode = ApiErrorInfo['code']

/** §5 — response meta, and §25's page meta with cursor state. */
export type Meta = components['schemas']['Meta']
export type PageMeta = components['schemas']['PageMeta']

/** Required path parameters — `{ id: string }` — or `never` when a path has none. */
export type PathParamsOf<Op> = Op extends { parameters: { path: infer P } }
  ? [NonNullable<P>] extends [never]
    ? never
    : NonNullable<P>
  : never

/** Query parameters, including §25 cursor/limit and the endpoint's declared filters. */
export type QueryOf<Op> = Op extends { parameters: { query?: infer Q } }
  ? Exclude<Q, undefined>
  : never

/** JSON request body, or `never` for operations that do not take one. */
export type BodyOf<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : Op extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B | undefined
    : never

type SuccessStatus = 200 | 201 | 202 | 204
type ResponsesOf<Op> = Op extends { responses: infer R } ? R : never

type SuccessEnvelope<Op> = {
  [S in SuccessStatus & keyof ResponsesOf<Op>]: ResponsesOf<Op>[S] extends {
    content: { 'application/json': infer E }
  }
    ? E
    : undefined
}[SuccessStatus & keyof ResponsesOf<Op>]

/** The `data` half of the §5 envelope for an operation's success response. */
export type DataOf<Op> = SuccessEnvelope<Op> extends { data: infer D } ? D : undefined

/** The `meta` half — `PageMeta` on collections, `Meta` elsewhere. */
export type MetaOf<Op> = SuccessEnvelope<Op> extends { meta: infer M } ? M : undefined

/** §29 — rate limit state, returned on every response rather than only on 429. */
export type RateLimitState = {
  limit: number | undefined
  remaining: number | undefined
  /** Seconds until the budget resets, as sent in RateLimit-Reset. */
  reset: number | undefined
}

/** What every call resolves to: the unwrapped envelope plus rate limit state. */
export type ApiResult<Op> = {
  data: DataOf<Op>
  meta: MetaOf<Op>
  requestId: string
  rateLimit: RateLimitState
}

/** Per-request options, typed by the operation they target. */
export type RequestOptions<Op> = {
  query?: QueryOf<Op>
  body?: BodyOf<Op>
  /**
   * §4 Idempotency-Key. Required by the API on the write operations that
   * declare idempotency, and what makes retrying a write safe: reusing the
   * key with the same body returns the original result.
   */
  idempotencyKey?: string
  /** §4 X-Request-ID. Generated when not supplied; echoed on every response. */
  requestId?: string
  signal?: AbortSignal
} & ([PathParamsOf<Op>] extends [never] ? { path?: undefined } : { path: PathParamsOf<Op> })

/**
 * Options become an optional argument only when the operation needs nothing:
 * a path-parameterised operation cannot be called without `path`.
 */
export type ArgsFor<Op> = [PathParamsOf<Op>] extends [never]
  ? [options?: RequestOptions<Op>]
  : [options: RequestOptions<Op>]

/** GET paths whose `data` is an array — the ones `paginate()` accepts. */
export type ListPath = {
  [P in PathsWith<'get'>]: DataOf<OpFor<P, 'get'>> extends readonly unknown[] ? P : never
}[PathsWith<'get'>]

export type ElementOf<T> = T extends readonly (infer E)[] ? E : never
