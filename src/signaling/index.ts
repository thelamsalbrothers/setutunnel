/**
 * Signaling plane — shared, IO-free pieces (CLAUDE.md §3, §5). The wire
 * protocol and the room-matching logic live here so both the browser client
 * and the self-hostable Bun server (`signaling/server.ts`) use the same code.
 * The server never sees plaintext — it only routes and relays opaque blobs.
 */

// Browser-only (uses the DOM `WebSocket`); the Bun server imports protocol/rooms
// directly and never pulls this in.
export { SignalingClient, type SignalingHandlers } from './client'
export {
  type ClientMessage,
  MAX_RELAY_PAYLOAD,
  MAX_ROOM_ID_LENGTH,
  parseClientMessage,
  type ServerMessage,
  type SignalingErrorCode,
} from './protocol'
export {
  RoomManager,
  type RoomManagerOptions,
  type SignalingPeer,
} from './rooms'
export {
  buildTurnPayload,
  mintTurnCredential,
  type TurnConfig,
  type TurnCredential,
  type TurnPayload,
} from './turn'
