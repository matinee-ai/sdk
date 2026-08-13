import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signWebhookPayload, verifyWebhookSignature } from '../src/index.ts'

const secret = 'whsec_test_secret'
const body = JSON.stringify({ type: 'reward.issued', data: { id: 'rex_1' } })

test('a signature produced by the signer verifies', () => {
  const signature = signWebhookPayload(body, secret)
  assert.equal(verifyWebhookSignature(body, signature, secret), true)
})

test('a tampered body fails verification', () => {
  const signature = signWebhookPayload(body, secret)
  const tampered = body.replace('rex_1', 'rex_2')
  assert.equal(verifyWebhookSignature(tampered, signature, secret), false)
})

test('the wrong secret fails verification', () => {
  const signature = signWebhookPayload(body, secret)
  assert.equal(verifyWebhookSignature(body, signature, 'whsec_other'), false)
})

test('a truncated signature fails without throwing', () => {
  const signature = signWebhookPayload(body, secret).slice(0, 32)
  assert.equal(verifyWebhookSignature(body, signature, secret), false)
})

test('a non-hex signature fails without throwing', () => {
  assert.equal(verifyWebhookSignature(body, 'not-a-hex-signature', secret), false)
})
