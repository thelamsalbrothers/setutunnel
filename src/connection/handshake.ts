import { fromHex, toHex, utf8, utf8Decode } from '../crypto/bytes'
import type { SessionDescription } from './types'

/**
 * Handshake payload carried inside the encrypted signaling envelope (§4.3): the
 * peer's SDP plus its ephemeral X25519 public key. It is decrypted from an
 * authenticated envelope, but we still validate the structure and fail closed —
 * treat every field as untrusted.
 */

export interface HandshakePayload {
  description: SessionDescription
  publicKey: Uint8Array // 32-byte X25519 public key
}

export function encodeHandshake(payload: HandshakePayload): Uint8Array {
  return utf8(
    JSON.stringify({
      sdp: payload.description,
      pk: toHex(payload.publicKey),
    }),
  )
}

export function decodeHandshake(bytes: Uint8Array): HandshakePayload {
  let raw: unknown
  try {
    raw = JSON.parse(utf8Decode(bytes))
  } catch {
    throw new Error('handshake: invalid JSON')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('handshake: not an object')
  }
  const sdp = (raw as { sdp?: unknown }).sdp
  if (
    typeof sdp !== 'object' ||
    sdp === null ||
    ((sdp as { type?: unknown }).type !== 'offer' &&
      (sdp as { type?: unknown }).type !== 'answer') ||
    typeof (sdp as { sdp?: unknown }).sdp !== 'string'
  ) {
    throw new Error('handshake: bad session description')
  }
  const pk = (raw as { pk?: unknown }).pk
  if (typeof pk !== 'string') {
    throw new Error('handshake: bad public key')
  }
  const publicKey = fromHex(pk)
  if (publicKey.length !== 32) {
    throw new Error('handshake: public key must be 32 bytes')
  }
  const description = sdp as SessionDescription
  return {
    description: { type: description.type, sdp: description.sdp },
    publicKey,
  }
}
