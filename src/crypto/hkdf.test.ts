import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { describe, expect, it } from 'vitest'
import { concatBytes, fromHex, toHex, utf8 } from './bytes'

// Cross-check the Web Crypto HKDF key schedule against an independent
// implementation (@noble/hashes). Both follow RFC 5869, so for identical
// (salt, IKM, info, L) they must produce identical output — this is what lets
// us trust the "extract-once, expand-per-label" schedule in hkdf.ts.
async function webHkdf(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)
const KDH = fromHex(
  '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
)
const SALT = utf8('setu-room-01')

describe('HKDF key schedule (Web Crypto vs @noble/hashes)', () => {
  for (const label of ['setu/a→b', 'setu/b→a', 'setu/sas']) {
    it(`agrees for label "${label}"`, async () => {
      const ikm = concatBytes(S, KDH)
      const info = utf8(label)
      const web = await webHkdf(ikm, SALT, info, 32)
      const noble = hkdf(sha256, ikm, SALT, info, 32)
      expect(toHex(web)).toBe(toHex(noble))
    })
  }

  it('separates keys by label (a→b ≠ b→a)', async () => {
    const ikm = concatBytes(S, KDH)
    const a = await webHkdf(ikm, SALT, utf8('setu/a→b'), 32)
    const b = await webHkdf(ikm, SALT, utf8('setu/b→a'), 32)
    expect(toHex(a)).not.toBe(toHex(b))
  })
})
