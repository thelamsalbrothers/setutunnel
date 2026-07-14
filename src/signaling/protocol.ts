/**
 * Signaling wire protocol (CLAUDE.md §3, §4.5). The signaling server only
 * *introduces* two peers and relays opaque blobs between them; it never sees
 * plaintext. `relay.payload` is the client's encrypted + HMAC-authenticated
 * envelope (SDP / ICE / ECDH pubkeys) — to the server it is just a string.
 *
 * Shared by the browser client and the Bun server, so it stays free of both
 * DOM and Bun APIs.
 */

/** Max relayed envelope size. Real envelopes are a few KB; this caps abuse. */
export const MAX_RELAY_PAYLOAD = 256 * 1024
/** Max room id length accepted (opaque/hashed id from pairing). */
export const MAX_ROOM_ID_LENGTH = 256

export type ClientMessage =
  | { type: 'create'; roomId: string }
  | { type: 'join'; roomId: string }
  | { type: 'relay'; payload: string }
  | { type: 'leave' }

export type SignalingErrorCode =
  | 'room-exists'
  | 'room-not-found'
  | 'room-full'
  | 'not-in-room'
  | 'bad-message'

export type ServerMessage =
  | { type: 'created'; roomId: string } // to the creator (peer A)
  | { type: 'joined'; roomId: string } // to the joiner (peer B)
  | { type: 'peer-joined' } // to the waiting creator when B arrives
  | { type: 'relay'; payload: string } // an envelope from the other peer
  | { type: 'peer-left' } // the other peer disconnected
  | { type: 'error'; code: SignalingErrorCode; message: string }

/**
 * Validate untrusted JSON from a socket into a typed ClientMessage, or null.
 * The server must treat every inbound frame as hostile (§4.7): unknown types,
 * missing fields, and oversized payloads are rejected here, before any logic.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const type = (obj as { type?: unknown }).type

  if (type === 'create' || type === 'join') {
    const roomId = (obj as { roomId?: unknown }).roomId
    if (
      typeof roomId !== 'string' ||
      roomId.length === 0 ||
      roomId.length > MAX_ROOM_ID_LENGTH
    ) {
      return null
    }
    return { type, roomId }
  }

  if (type === 'relay') {
    const payload = (obj as { payload?: unknown }).payload
    if (typeof payload !== 'string' || payload.length > MAX_RELAY_PAYLOAD) {
      return null
    }
    return { type: 'relay', payload }
  }

  if (type === 'leave') return { type: 'leave' }

  return null
}
