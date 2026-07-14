import { x25519 } from '@noble/curves/ed25519'

/**
 * Ephemeral X25519 keypairs give the session forward secrecy (CLAUDE.md §4.3):
 * fresh keys per tunnel mean a later key compromise can't decrypt past
 * transfers. X25519 lives in @noble/curves because Web Crypto's ECDH coverage
 * for Curve25519 is inconsistent across browsers (§4.6).
 */
export interface EphemeralKeyPair {
  /** 32-byte secret scalar. Zeroize once the session is derived. */
  secretKey: Uint8Array
  /** 32-byte public key, sent inside the encrypted signaling envelope. */
  publicKey: Uint8Array
}

export function generateKeyPair(): EphemeralKeyPair {
  const secretKey = x25519.utils.randomSecretKey()
  const publicKey = x25519.getPublicKey(secretKey)
  return { secretKey, publicKey }
}

/** K_dh = X25519(mySecret, theirPublic) — the ephemeral ECDH shared secret. */
export function computeSharedSecret(
  mySecretKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(mySecretKey, theirPublicKey)
}
