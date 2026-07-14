import { describe, expect, it } from 'vitest'
import { toHex } from '../crypto/bytes'
import { buildPairingUrl, generatePairing, parsePairingUrl } from './pairing'

const ORIGIN = 'https://setu.example'

describe('pairing (Link/QR, §4.3)', () => {
  it('generates a 256-bit secret and a non-empty roomId', () => {
    const p = generatePairing()
    expect(p.secret).toHaveLength(32)
    expect(p.roomId.length).toBeGreaterThan(0)
  })

  it('produces distinct secrets each time', () => {
    expect(toHex(generatePairing().secret)).not.toBe(
      toHex(generatePairing().secret),
    )
  })

  it('round-trips secret and roomId through the URL', () => {
    const p = generatePairing()
    const url = buildPairingUrl(ORIGIN, p)
    const parsed = parsePairingUrl(url)
    expect(parsed.roomId).toBe(p.roomId)
    expect(toHex(parsed.secret)).toBe(toHex(p.secret))
  })

  it('SECURITY: the secret lives only in the hash, never the path or query', () => {
    const p = generatePairing()
    const url = new URL(buildPairingUrl(ORIGIN, p))
    const secretB64 = url.hash.slice(1)
    expect(secretB64.length).toBeGreaterThan(0)
    // The exact secret material must not leak into the path or query string.
    expect(url.pathname).not.toContain(secretB64)
    expect(url.search).toBe('')
    expect(url.pathname).toBe(`/r/${p.roomId}`)
  })

  it('fails closed when the hash fragment is missing', () => {
    expect(() => parsePairingUrl(`${ORIGIN}/r/abc123`)).toThrow(/secret/)
  })

  it('fails closed on a malformed room path', () => {
    expect(() => parsePairingUrl(`${ORIGIN}/nope#deadbeef`)).toThrow(/roomId/)
  })

  it('fails closed when the secret is the wrong length', () => {
    // A 4-byte (not 32-byte) secret must be rejected.
    expect(() => parsePairingUrl(`${ORIGIN}/r/abc#3q2-7w`)).toThrow(/bytes/)
  })
})
