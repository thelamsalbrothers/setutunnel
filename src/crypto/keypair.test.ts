import { x25519 } from '@noble/curves/ed25519'
import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from './bytes'
import { computeSharedSecret, generateKeyPair } from './keypair'

// RFC 7748 §6.1 X25519 test vector — an independent known-answer check that our
// ECDH usage (and the underlying @noble/curves) is correct.
const ALICE_PRIV = fromHex(
  '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
)
const ALICE_PUB =
  '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
const BOB_PRIV = fromHex(
  '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
)
const BOB_PUB =
  'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'
const SHARED =
  '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'

describe('X25519 key agreement', () => {
  it('matches the RFC 7748 public-key vector', () => {
    expect(toHex(x25519.getPublicKey(ALICE_PRIV))).toBe(ALICE_PUB)
    expect(toHex(x25519.getPublicKey(BOB_PRIV))).toBe(BOB_PUB)
  })

  it('derives the RFC 7748 shared secret (both directions agree)', () => {
    expect(toHex(computeSharedSecret(ALICE_PRIV, fromHex(BOB_PUB)))).toBe(
      SHARED,
    )
    expect(toHex(computeSharedSecret(BOB_PRIV, fromHex(ALICE_PUB)))).toBe(
      SHARED,
    )
  })

  it('generates 32-byte ephemeral keypairs that agree', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(a.secretKey).toHaveLength(32)
    expect(a.publicKey).toHaveLength(32)
    const kAB = computeSharedSecret(a.secretKey, b.publicKey)
    const kBA = computeSharedSecret(b.secretKey, a.publicKey)
    expect(toHex(kAB)).toBe(toHex(kBA))
  })
})
