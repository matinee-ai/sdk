/**
 * A scripted fetch: each call consumes the next enqueued response and records
 * the request it was given. No network, no timers — the client's injectable
 * transport and sleep make every behaviour observable synchronously.
 */

export type RecordedRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export type ScriptedResponse =
  | { status: number; json?: unknown; headers?: Record<string, string> }
  | { networkError: string }

export function scriptedFetch(script: ScriptedResponse[]) {
  const requests: RecordedRequest[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const step = script.shift()
    if (!step) throw new Error('scriptedFetch: no response scripted for this request')
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    if ('networkError' in step) throw new TypeError(step.networkError)
    return new Response(step.json === undefined ? null : JSON.stringify(step.json), {
      status: step.status,
      headers: step.headers,
    })
  }
  return { fetchImpl: fetchImpl as typeof globalThis.fetch, requests }
}

export function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, meta: { request_id: 'req_test', version: 'v1', ...meta } }
}

export function errorEnvelope(type: string, code: string, message = 'Test failure.') {
  return { error: { type, code, message, request_id: 'req_err' }, meta: { request_id: 'req_err', version: 'v1' } }
}

export function recordedSleep() {
  const delays: number[] = []
  const sleep = async (ms: number) => {
    delays.push(ms)
  }
  return { delays, sleep }
}
