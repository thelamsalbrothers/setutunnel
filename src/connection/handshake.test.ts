import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8 } from '../crypto/bytes'
import { decodeHandshake, encodeHandshake } from './handshake'

describe('handshake codec', () => {
  it('round-trips a description and public key', () => {
    const publicKey = fromHex('aa'.repeat(32))
    const encoded = encodeHandshake({
      description: { type: 'offer', sdp: 'v=0 ...' },
      publicKey,
    })
    const decoded = decodeHandshake(encoded)
    expect(decoded.description).toEqual({ type: 'offer', sdp: 'v=0 ...' })
    expect(toHex(decoded.publicKey)).toBe('aa'.repeat(32))
  })

  it('rejects malformed payloads (fail closed)', () => {
    expect(() => decodeHandshake(utf8('not json'))).toThrow()
    expect(() => decodeHandshake(utf8('{}'))).toThrow()
    expect(() =>
      decodeHandshake(utf8('{"sdp":{"type":"bad","sdp":"x"},"pk":"aa"}')),
    ).toThrow()
    // Public key must be 32 bytes.
    expect(() =>
      decodeHandshake(utf8('{"sdp":{"type":"offer","sdp":"x"},"pk":"aabb"}')),
    ).toThrow()
  })
})
