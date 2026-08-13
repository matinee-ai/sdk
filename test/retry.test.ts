import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MatineeApiError, MatineeClient } from '../src/index.ts'
import { envelope, errorEnvelope, recordedSleep, scriptedFetch } from './helpers.ts'

function client(fetchImpl: typeof globalThis.fetch, sleep: (ms: number) => Promise<void>) {
  return new MatineeClient({ apiKey: 'mk_test', organizationId: 'org_1', fetch: fetchImpl, sleep })
}

test('retries a 429 and honours RateLimit-Reset for the delay', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    {
      status: 429,
      json: errorEnvelope('rate_limit_error', 'rate_limit_exceeded'),
      headers: { 'RateLimit-Reset': '2' },
    },
    { status: 200, json: envelope([]) },
  ])
  const { delays, sleep } = recordedSleep()

  const result = await client(fetchImpl, sleep).get('/customers')
  assert.equal(requests.length, 2)
  assert.deepEqual(delays, [2000])
  assert.deepEqual(result.data, [])
})

test('retries a 5xx read with exponential backoff', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 500, json: errorEnvelope('service_error', 'internal_error') },
    { status: 500, json: errorEnvelope('service_error', 'internal_error') },
    { status: 200, json: envelope([]) },
  ])
  const { delays, sleep } = recordedSleep()

  await client(fetchImpl, sleep).get('/customers')
  assert.equal(requests.length, 3)
  assert.deepEqual(delays, [500, 1000])
})

test('never retries a 5xx write that carries no Idempotency-Key', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 500, json: errorEnvelope('service_error', 'internal_error') },
  ])
  const { sleep } = recordedSleep()

  await assert.rejects(() => client(fetchImpl, sleep).post('/events', { body: { type: 'x' } }))
  assert.equal(requests.length, 1)
})

test('retries a 5xx write when an Idempotency-Key makes the retry safe', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 500, json: errorEnvelope('service_error', 'internal_error') },
    { status: 201, json: envelope({ id: 'evt_1' }) },
  ])
  const { sleep } = recordedSleep()

  const result = await client(fetchImpl, sleep).post('/events', {
    body: { type: 'order.completed' },
    idempotencyKey: 'order-1',
  })
  assert.equal(requests.length, 2)
  assert.deepEqual(result.data, { id: 'evt_1' })
})

test('retries a network failure on reads', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { networkError: 'fetch failed' },
    { status: 200, json: envelope([]) },
  ])
  const { sleep } = recordedSleep()

  await client(fetchImpl, sleep).get('/customers')
  assert.equal(requests.length, 2)
})

test('never retries a conflict — it fails the same way twice', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 409, json: errorEnvelope('conflict', 'event_duplicate') },
  ])
  const { sleep } = recordedSleep()

  await assert.rejects(
    () => client(fetchImpl, sleep).post('/events', { body: {}, idempotencyKey: 'k' }),
    (error: unknown) => error instanceof MatineeApiError && error.code === 'event_duplicate',
  )
  assert.equal(requests.length, 1)
})

test('gives up after maxAttempts and surfaces the last error', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 429, json: errorEnvelope('rate_limit_error', 'rate_limit_exceeded') },
    { status: 429, json: errorEnvelope('rate_limit_error', 'rate_limit_exceeded') },
    { status: 429, json: errorEnvelope('rate_limit_error', 'rate_limit_exceeded') },
  ])
  const { sleep } = recordedSleep()

  await assert.rejects(
    () => client(fetchImpl, sleep).get('/customers'),
    (error: unknown) => error instanceof MatineeApiError && error.code === 'rate_limit_exceeded',
  )
  assert.equal(requests.length, 3)
})
