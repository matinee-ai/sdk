/**
 * @matinee/sdk — the reference TypeScript client for the Matinee AI v1 API.
 *
 * Unpublished by design: no npm package exists until the API it calls is
 * served. Everything typed here derives from the generated OpenAPI
 * definitions in `api/matinee.d.ts`, so the client cannot describe an
 * endpoint, parameter or error code the specification does not define.
 */

export { BASE_URLS, MatineeClient, SDK_VERSION } from './client.ts'
export type { ClientConfig, Environment } from './client.ts'
export { MatineeApiError, MatineeConnectionError } from './errors.ts'
export { signWebhookPayload, verifyWebhookSignature } from './webhooks.ts'
export type {
  ApiErrorInfo,
  ApiResult,
  ErrorCode,
  ErrorType,
  ListPath,
  Meta,
  PageMeta,
  RateLimitState,
  RequestOptions,
} from './types.ts'
