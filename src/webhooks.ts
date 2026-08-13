/**
 * Webhook signature verification — Phase 7 §19.2's signed delivery, verified
 * the way the Examples page documents it: HMAC-SHA256 over the raw body,
 * compared in constant time. A plain `===` leaks the signature a byte at a
 * time to anyone willing to measure.
 *
 * Node-only by design: this is the server SDK's half. The signing secret is
 * returned once when the endpoint is registered and never again.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!/^[0-9a-f]+$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(signature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}
