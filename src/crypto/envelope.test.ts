import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8, utf8Decode } from './bytes'
import { decryptEnvelope, deriveEnvelopeKey, encryptEnvelope } from './envelope'

const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)
const ROOM = 'room-42'

describe('signaling envelope crypto (§4.3)', () => {
  it('A→B round-trips (both derive the same key from S)', async () => {
    const kA = await deriveEnvelopeKey(S, ROOM)
    const kB = await deriveEnvelopeKey(S, ROOM)
    const env = await encryptEnvelope(kA, 'A', ROOM, utf8('offer-sdp'))
    const pt = await decryptEnvelope(kB, 'B', ROOM, env)
    expect(utf8Decode(pt)).toBe('offer-sdp')
  })

  it('rejects a reflected own envelope (anti-reflection)', async () => {
    const k = await deriveEnvelopeKey(S, ROOM)
    const env = await encryptEnvelope(k, 'A', ROOM, utf8('x'))
    // A receiving its own 'A' envelope back must fail (it expects sender 'B').
    await expect(decryptEnvelope(k, 'A', ROOM, env)).rejects.toThrow()
  })

  it('fails closed on a tampered ciphertext', async () => {
    const k = await deriveEnvelopeKey(S, ROOM)
    const env = await encryptEnvelope(k, 'A', ROOM, utf8('x'))
    env[env.length - 1] ^= 0x01
    await expect(decryptEnvelope(k, 'B', ROOM, env)).rejects.toThrow()
  })

  it('fails when the roomId (salt + AAD) differs', async () => {
    const kA = await deriveEnvelopeKey(S, ROOM)
    const kOther = await deriveEnvelopeKey(S, 'other-room')
    const env = await encryptEnvelope(kA, 'A', ROOM, utf8('x'))
    await expect(
      decryptEnvelope(kOther, 'B', 'other-room', env),
    ).rejects.toThrow()
  })

  it('cannot be decrypted with a different pairing secret', async () => {
    const kA = await deriveEnvelopeKey(S, ROOM)
    const kBad = await deriveEnvelopeKey(fromHex('ff'.repeat(32)), ROOM)
    const env = await encryptEnvelope(kA, 'A', ROOM, utf8('x'))
    await expect(decryptEnvelope(kBad, 'B', ROOM, env)).rejects.toThrow()
  })

  it('uses a fresh random nonce each call', async () => {
    const k = await deriveEnvelopeKey(S, ROOM)
    const e1 = await encryptEnvelope(k, 'A', ROOM, utf8('same'))
    const e2 = await encryptEnvelope(k, 'A', ROOM, utf8('same'))
    expect(toHex(e1)).not.toBe(toHex(e2))
  })
})
