import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MatineeClient } from '../src/index.ts'
import { envelope, scriptedFetch } from './helpers.ts'

function client(fetchImpl: typeof globalThis.fetch) {
  return new MatineeClient({ apiKey: 'mk_test', organizationId: 'org_1', fetch: fetchImpl, sleep: async () => {} })
}

test('paginate follows next_cursor until has_more is false', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 200, json: envelope([{ id: 'a' }, { id: 'b' }], { next_cursor: 'cur_2', has_more: true }) },
    { status: 200, json: envelope([{ id: 'c' }], { next_cursor: null, has_more: false }) },
  ])

  const seen: unknown[] = []
  for await (const item of client(fetchImpl).paginate('/customers', { query: { limit: 2 } })) {
    seen.push((item as { id: string }).id)
  }

  assert.deepEqual(seen, ['a', 'b', 'c'])
  assert.equal(requests.length, 2)
  assert.match(requests[0]!.url, /limit=2/)
  assert.doesNotMatch(requests[0]!.url, /cursor=/)
  assert.match(requests[1]!.url, /cursor=cur_2/)
  assert.match(requests[1]!.url, /limit=2/, 'filters persist across pages')
})

test('paginate stops after a single page when has_more is false', async () => {
  const { fetchImpl, requests } = scriptedFetch([
    { status: 200, json: envelope([{ id: 'only' }], { has_more: false }) },
  ])

  const seen: unknown[] = []
  for await (const item of client(fetchImpl).paginate('/customers')) seen.push(item)

  assert.equal(seen.length, 1)
  assert.equal(requests.length, 1)
})

test('paginate yields nothing for an empty collection', async () => {
  const { fetchImpl } = scriptedFetch([{ status: 200, json: envelope([], { has_more: false }) }])

  const seen: unknown[] = []
  for await (const item of client(fetchImpl).paginate('/customers')) seen.push(item)
  assert.deepEqual(seen, [])
})
