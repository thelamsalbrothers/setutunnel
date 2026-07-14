import { asBufferSource, concatBytes, utf8 } from './bytes'
import { deriveAesKey } from './hkdf'

/**
 * Signaling-envelope encryption (CLAUDE.md §4.2, §4.3). Before the handshake
 * yields a session, the SDP / ICE / X25519 pubkeys must cross the untrusted
 * signaling server. They travel inside an AES-256-GCM envelope keyed from the
 * pairing secret S (which the server never sees), so a hostile server can
 * neither read them nor tamper undetected — the basis for the SAS defeating a
 * MITM. AES-GCM is authenticated encryption, satisfying the "encrypted +
 * authenticated with a sub-key of S" requirement.
 *
 * Anti-reflection: the sender's role (A = creator, B = joiner) is bound into
 * the AAD, and each side only accepts envelopes stamped with the *other* role.
 * A server that reflects a peer's own envelope back therefore fails to decrypt.
 */

export type EnvelopeRole = 'A' | 'B'
export const ENVELOPE_NONCE_LEN = 12

const ENVELOPE_LABEL = utf8('setu/envelope')

function roomSalt(roomId: string | Uint8Array): Uint8Array {
  return typeof roomId === 'string' ? utf8(roomId) : roomId
}

function envelopeAad(
  roomId: string | Uint8Array,
  senderRole: EnvelopeRole,
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    roomSalt(roomId),
    Uint8Array.of(senderRole === 'A' ? 65 : 66),
  )
}

/** Derive the envelope key from S alone: HKDF(salt = roomId, IKM = S). */
export async function deriveEnvelopeKey(
  pairingSecret: Uint8Array,
  roomId: string | Uint8Array,
): Promise<CryptoKey> {
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(pairingSecret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return deriveAesKey(ikmKey, roomSalt(roomId), ENVELOPE_LABEL)
}

/** Encrypt an envelope. Output is `nonce(12) ‖ AES-GCM ciphertext`. */
export async function encryptEnvelope(
  key: CryptoKey,
  senderRole: EnvelopeRole,
  roomId: string | Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(ENVELOPE_NONCE_LEN))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: envelopeAad(roomId, senderRole),
    },
    key,
    asBufferSource(plaintext),
  )
  return concatBytes(nonce, new Uint8Array(ciphertext))
}

/**
 * Decrypt an envelope from the *other* peer. `myRole` is this peer's role; the
 * expected sender is the opposite role, so a reflected own envelope fails.
 * Throws (fail closed) on any tampering, wrong room, or wrong secret.
 */
export async function decryptEnvelope(
  key: CryptoKey,
  myRole: EnvelopeRole,
  roomId: string | Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (data.length <= ENVELOPE_NONCE_LEN) {
    throw new Error('envelope: shorter than nonce')
  }
  const senderRole: EnvelopeRole = myRole === 'A' ? 'B' : 'A'
  const nonce = data.subarray(0, ENVELOPE_NONCE_LEN)
  const ciphertext = data.subarray(ENVELOPE_NONCE_LEN)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(nonce),
      additionalData: envelopeAad(roomId, senderRole),
    },
    key,
    asBufferSource(ciphertext),
  )
  return new Uint8Array(plaintext)
}
