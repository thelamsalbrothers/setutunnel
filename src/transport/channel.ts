/**
 * The subset of `RTCDataChannel` the transport actually needs (CLAUDE.md §6D).
 * Depending on this interface (rather than the concrete channel) keeps the
 * Sender/Receiver and the backpressure logic unit-testable with a fake channel,
 * and lets a real `RTCDataChannel` be dropped in unchanged (it structurally
 * satisfies this shape).
 */
/** Events the backpressure gate listens for: drain, and terminal close/error. */
export type DataChannelEvent = 'bufferedamountlow' | 'close' | 'error'

export interface DataChannelLike {
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed'
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  send(data: Uint8Array): void
  addEventListener(type: DataChannelEvent, listener: () => void): void
  removeEventListener(type: DataChannelEvent, listener: () => void): void
}
