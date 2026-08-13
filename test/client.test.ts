import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MatineeApiError, MatineeClient, MatineeConnectionError } from '../src/index.ts'
import { envelope, errorEnvelope, scriptedFetch } from './helpers.ts'

function client(fetchImpl: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof MatineeClient>[0]> = {}) {
  return new MatineeClient({
    apiKey: 'mk_test_key',
    organizationId: 'org_1',
    fetch: fetchImpl,
    sleep: async () => {},
    ...extra,
  })
}

test('sends the §4 headers on every authenticated call', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 200, json: envelope([]) }])
  await client(fetchImpl).get('/customers')

  const headers = requests[0]!.headers
  assert.equal(headers.Authorization, 'Bearer mk_test_key')
  assert.equal(headers['X-Organization-ID'], 'org_1')
  assert.equal(headers['X-Environment'], 'sandbox')
  assert.match(headers['X-Request-ID']!, /[0-9a-f-]{36}/)
  assert.match(headers['X-SDK-Version']!, /^matinee-sdk-typescript\//)
  assert.equal(headers['Idempotency-Key'], undefined)
  assert.equal(headers['Content-Type'], undefined)
})

test('defaults to the sandbox base URL from §3', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 200, json: envelope([]) }])
  await client(fetchImpl).get('/customers')
  assert.equal(requests[0]!.url, 'https://sandbox-api.matinee.ai/v1/customers')
})

test('production environment switches base URL and X-Environment together', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 200, json: envelope([]) }])
  await client(fetchImpl, { environment: 'production' }).get('/customers')
  assert.equal(requests[0]!.url, 'https://api.matinee.ai/v1/customers')
  assert.equal(requests[0]!.headers['X-Environment'], 'production')
})

test('writes carry the body, Content-Type and Idempotency-Key', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 201, json: envelope({ id: 'cus_1' }) }])
  const result = await client(fetchImpl).post('/customers', {
    body: { external_id: 'user-1' },
    idempotencyKey: 'customer-user-1',
  })

  assert.equal(requests[0]!.method, 'POST')
  assert.deepEqual(requests[0]!.body, { external_id: 'user-1' })
  assert.equal(requests[0]!.headers['Content-Type'], 'application/json')
  assert.equal(requests[0]!.headers['Idempotency-Key'], 'customer-user-1')
  assert.deepEqual(result.data, { id: 'cus_1' })
  assert.equal(result.requestId, 'req_test')
})

test('substitutes and encodes path parameters', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 200, json: envelope([]) }])
  await client(fetchImpl).get('/wallets/{id}/balances', { path: { id: 'wal 1' } })
  assert.equal(requests[0]!.url, 'https://sandbox-api.matinee.ai/v1/wallets/wal%201/balances')
})

test('throws before sending when a path parameter is missing', async () => {
  const { fetchImpl, requests } = scriptedFetch([])
  await assert.rejects(
    // Cast: deliberately violating the types to prove the runtime guard holds.
    () => client(fetchImpl).get('/wallets/{id}/balances', { path: {} as { id: string } }),
    /Missing path parameter "id"/,
  )
  assert.equal(requests.length, 0)
})

test('serialises query parameters and skips undefined ones', async () => {
  const { fetchImpl, requests } = scriptedFetch([{ status: 200, json: envelope([]) }])
  await client(fetchImpl).get('/customers', {
    query: { limit: 10, status: undefined, sort: 'created_at' },
  })
  assert.equal(
    requests[0]!.url,
    'https://sandbox-api.matinee.ai/v1/customers?limit=10&sort=created_at',
  )
})

test('maps the §6 error envelope onto MatineeApiError', async () => {
  const { fetchImpl } = scriptedFetch([
    { status: 409, json: errorEnvelope('conflict', 'wallet_frozen', 'This wallet is frozen and cannot transact.') },
  ])
  await assert.rejects(
    () => client(fetchImpl).post('/customers', { body: {}, idempotencyKey: 'k1' }),
    (error: unknown) => {
      assert.ok(error instanceof MatineeApiError)
      assert.equal(error.type, 'conflict')
      assert.equal(error.code, 'wallet_frozen')
      assert.equal(error.status, 409)
      assert.equal(error.requestId, 'req_err')
      assert.equal(error.retryable, false)
      return true
    },
  )
})

test('a non-envelope failure body becomes MatineeConnectionError, not a fake API error', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 502, json: { message: 'Bad gateway' } }])
  await assert.rejects(
    () => client(fetchImpl).get('/customers'),
    (error: unknown) => error instanceof MatineeConnectionError,
  )
})

test('204 responses resolve with undefined data', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 204 }])
  const result = await client(fetchImpl).delete('/webhooks/{id}', { path: { id: 'wh_1' } })
  assert.equal(result.data, undefined)
})

test('exposes §29 rate limit state on every successful result', async () => {
  const { fetchImpl } = scriptedFetch([
    {
      status: 200,
      json: envelope([]),
      headers: { 'RateLimit-Limit': '100', 'RateLimit-Remaining': '97', 'RateLimit-Reset': '42' },
    },
  ])
  const result = await client(fetchImpl).get('/customers')
  assert.deepEqual(result.rateLimit, { limit: 100, remaining: 97, reset: 42 })
})
