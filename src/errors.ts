/**
 * Typed errors over the §6 envelope.
 *
 * A caller switches on `type` for behaviour and on `code` for a message —
 * both are literal unions from the generated definitions, so a typo in either
 * is a compile error. `request_id` is preserved on every error because it is
 * the one string that connects a client-side failure to the server-side
 * request log.
 */

import type { ApiErrorInfo, ErrorCode, ErrorType, RateLimitState } from './types.ts'

export class MatineeApiError extends Error {
  readonly type: ErrorType
  readonly code: ErrorCode
  readonly requestId: string
  readonly details: Record<string, unknown> | undefined
  readonly status: number
  readonly rateLimit: RateLimitState

  constructor(info: ApiErrorInfo, status: number, rateLimit: RateLimitState) {
    super(info.message)
    this.name = 'MatineeApiError'
    this.type = info.type
    this.code = info.code
    this.requestId = info.request_id
    this.details = info.details
    this.status = status
    this.rateLimit = rateLimit
  }

  /**
   * Whether retrying the identical request can succeed. True only for rate
   * limiting and server errors — everything else fails the same way twice,
   * and retrying it only delays the message the caller needs to see.
   */
  get retryable(): boolean {
    return this.type === 'rate_limit_error' || this.type === 'service_error'
  }
}

/**
 * The request never produced an API response: DNS failure, refused
 * connection, abort, or a body that was not the §5 envelope. Distinct from
 * MatineeApiError because there is no error code and no request id to report.
 */
export class MatineeConnectionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'MatineeConnectionError'
  }
}
