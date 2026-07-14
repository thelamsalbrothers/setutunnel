/**
 * Module D — Transport & reliability (CLAUDE.md §6D), plus the streaming halves
 * of Modules C (Sender) and E (Receiver). Frames every DataChannel message
 * through Module A's AEAD, gates sends with backpressure, and enforces
 * monotonic, fail-closed delivery. Depends only on the `DataChannelLike`
 * interface, so it unit-tests without a real WebRTC connection.
 */

export { DEFAULT_HIGH_WATER, sendWithBackpressure } from './backpressure'
export type { DataChannelLike } from './channel'
export {
  buildAadContext,
  decodeHeader,
  encodeHeader,
  FRAME_HEADER_LEN,
  FRAME_VERSION,
  type FrameHeader,
  FrameType,
} from './frame'
export {
  TransportLink,
  type TransportLinkEvents,
  type TransportLinkOptions,
} from './link'
export { MemorySink, MemorySource } from './memory'
export {
  type ChunkSink,
  Receiver,
  type ReceiverEvent,
  type ReceiverOptions,
} from './receiver'
export { type ChunkSource, Sender, type SenderOptions } from './sender'
export {
  createWebRtcConnector,
  DEFAULT_ICE_SERVERS,
  type WebRtcConnectorOptions,
} from './webrtc'
