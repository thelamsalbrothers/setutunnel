import type { Session } from '../crypto/session'
import type { ControlMessage } from '../protocol/messages'
import type { DataChannelLike } from './channel'
import { type ChunkSink, Receiver, type ReceiverEvent } from './receiver'
import { type ChunkSource, Sender } from './sender'

/**
 * Full-duplex transport over a single WebRTC DataChannel (CLAUDE.md §4.4, §6).
 * A DataChannel is bidirectional, and the session gives each peer a separate
 * key + direction id + nonce space for its *send* and *recv* directions. So
 * both peers can transfer at the same time: this link owns exactly one `Sender`
 * (send direction) and one `Receiver` (recv direction), and the two directions
 * are cryptographically independent — a frame from one can never be decrypted
 * as the other (different key), and their monotonic nonce counters never share
 * a value.
 *
 * SECURITY — single nonce authority. The whole point of owning *one* `Sender`
 * per link is that a single object is the sole allocator of this direction's
 * monotonic `seq` (= AES-GCM nonce counter). Never construct a second `Sender`
 * on the same direction/key: two allocators could hand out the same seq and
 * reuse a (key, nonce) pair. Queue everything through this one link instead.
 */

export interface TransportLinkEvents {
  /** A decrypted, in-order frame arrived (control message or data chunk). */
  onReceive?: (event: ReceiverEvent) => void
  /** Bytes handed to the transport for this peer's outgoing transfer. */
  onSendProgress?: (bytesSent: number) => void
}

export interface TransportLinkOptions {
  channel: DataChannelLike
  session: Session
  /** Transfer id bound into every frame's AAD (both peers agree on it). */
  transferId: Uint8Array
  /** Where this peer's *incoming* bytes are written. */
  sink: ChunkSink
  chunkSize?: number
  events?: TransportLinkEvents
}

export class TransportLink {
  private readonly sender: Sender
  private readonly receiver: Receiver
  private readonly events: TransportLinkEvents
  private incomingChain: Promise<unknown> = Promise.resolve()

  constructor(options: TransportLinkOptions) {
    this.events = options.events ?? {}
    this.sender = new Sender({
      channel: options.channel,
      sendKey: options.session.sendKey,
      directionId: options.session.sendDirectionId,
      transferId: options.transferId,
      chunkSize: options.chunkSize,
      onProgress: this.events.onSendProgress,
    })
    this.receiver = new Receiver({
      recvKey: options.session.recvKey,
      directionId: options.session.recvDirectionId,
      transferId: options.transferId,
      sink: options.sink,
    })
  }

  /** Send an encrypted control message on this peer's send direction. */
  sendControl(message: ControlMessage): Promise<void> {
    return this.sender.sendControl(message)
  }

  /** Stream a file on this peer's send direction. Await sequentially. */
  sendFile(source: ChunkSource): Promise<void> {
    return this.sender.sendFile(source)
  }

  /**
   * Feed one raw frame received from the peer (wire this to the DataChannel's
   * `message` event). Decrypts, validates monotonic order, reassembles into the
   * sink, and returns the event. Throws (fail closed) on tamper / reorder /
   * wrong-direction — the caller must abort the transfer on rejection.
   *
   * Calls are serialized: the `Receiver` must see frames strictly one at a time
   * in arrival order, but a live DataChannel can fire `message` again while a
   * previous decrypt is still awaiting. Each frame is chained after the last.
   */
  handleIncoming(frame: Uint8Array): Promise<ReceiverEvent> {
    const run = this.incomingChain.then(
      () => this.receiver.handleFrame(frame),
      () => this.receiver.handleFrame(frame),
    )
    // Keep the chain alive past a rejection (so ordering holds) without leaking
    // an unhandled rejection; the caller still sees `run` reject.
    this.incomingChain = run.catch(() => undefined)
    return run.then((event) => {
      this.events.onReceive?.(event)
      return event
    })
  }

  /** Resolves once all currently-queued incoming frames have been processed. */
  async whenIdle(): Promise<void> {
    await this.incomingChain
  }
}
