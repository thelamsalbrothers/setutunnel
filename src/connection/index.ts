/**
 * Connection layer (CLAUDE.md §3): the handshake orchestrator plus the
 * abstractions (`PeerConnector`, `SignalingChannel`, `DuplexChannel`) it drives.
 * `connect()` is framework-agnostic — the browser WebRTC binding and the
 * `SignalingClient` plug in behind these interfaces.
 */

export {
  decodeHandshake,
  encodeHandshake,
  type HandshakePayload,
} from './handshake'
export {
  type Connection,
  type ConnectOptions,
  type ConnectRole,
  connect,
} from './orchestrator'
export type {
  DuplexChannel,
  PeerConnector,
  SessionDescription,
  SignalingChannel,
} from './types'
