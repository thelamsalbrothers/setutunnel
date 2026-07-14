import type { DataChannelLike } from '../transport/channel'

/**
 * Abstractions the connection orchestrator (CLAUDE.md §3, §6B) depends on,
 * instead of concrete WebRTC / WebSocket objects. This keeps the whole
 * handshake choreography unit-testable with fakes + real crypto; the browser
 * WebRTC binding and the `SignalingClient` implement these shapes.
 */

export interface SessionDescription {
  type: 'offer' | 'answer'
  sdp: string
}

/** A DataChannel that can both send (backpressured) and deliver frames. */
export interface DuplexChannel extends DataChannelLike {
  onMessage(handler: (frame: Uint8Array) => void): void
}

/**
 * Establishes the peer connection for one fixed role. Non-trickle ICE: `offer`
 * / `answer` return a fully gathered description, so no separate candidate
 * relay is needed for v0.
 */
export interface PeerConnector {
  /** Offerer (A): create the data channel and a complete offer. */
  offer(): Promise<SessionDescription>
  /** Answerer (B): apply the remote offer, return a complete answer. */
  answer(remote: SessionDescription): Promise<SessionDescription>
  /** Offerer (A): apply the remote answer. */
  accept(remote: SessionDescription): Promise<void>
  /** Resolves with the open DataChannel (A created it; B received it). */
  channel(): Promise<DuplexChannel>
  close(): void
}

/** The signaling side the orchestrator needs; `SignalingClient` satisfies it. */
export interface SignalingChannel {
  create(roomId: string): Promise<void>
  join(roomId: string): Promise<void>
  sendRelay(payload: string): void
  onRelay?: (payload: string) => void
  onPeerJoined?: () => void
  onPeerLeft?: () => void
}
