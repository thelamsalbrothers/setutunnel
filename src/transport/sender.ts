import { encryptChunk } from '../crypto/aead'
import { concatBytes, utf8 } from '../crypto/bytes'
import { DEFAULT_CHUNK_SIZE } from '../protocol/constants'
import type { ControlMessage } from '../protocol/messages'
import { sendWithBackpressure } from './backpressure'
import type { DataChannelLike } from './channel'
import {
  buildAadContext,
  encodeHeader,
  FRAME_VERSION,
  FrameType,
} from './frame'

/**
 * Sender (CLAUDE.md §6C). Reads the source in slices — never the whole file —
 * encrypts each with Module A, and hands frames to the transport under
 * backpressure (§6D). A monotonic `seq` numbers every frame in this direction;
 * it is the AES-GCM nonce counter, so it must never rewind within a session.
 */

/** A byte source read lazily by offset (a File, an OPFS handle, memory, …). */
export interface ChunkSource {
  readonly size: number
  readSlice(offset: number, length: number): Promise<Uint8Array>
}

export interface SenderOptions {
  channel: DataChannelLike
  /** This peer's outgoing AES-256-GCM key (Session.sendKey). */
  sendKey: CryptoKey
  /** This peer's outgoing direction id (Session.sendDirectionId). */
  directionId: number
  /** Transfer id bound into every frame's AAD. */
  transferId: Uint8Array
  chunkSize?: number
  highWater?: number
  onProgress?: (bytesSent: number) => void
}

export class Sender {
  private seq = 0n
  private readonly channel: DataChannelLike
  private readonly sendKey: CryptoKey
  private readonly directionId: number
  private readonly transferId: Uint8Array
  private readonly chunkSize: number
  private readonly highWater: number | undefined
  private readonly onProgress: ((bytesSent: number) => void) | undefined

  constructor(options: SenderOptions) {
    this.channel = options.channel
    this.sendKey = options.sendKey
    this.directionId = options.directionId
    this.transferId = options.transferId
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.highWater = options.highWater
    this.onProgress = options.onProgress
  }

  /** Send an encrypted control message (manifest, EOF, ACK, …). */
  async sendControl(message: ControlMessage): Promise<void> {
    await this.sendFrame(
      FrameType.Control,
      false,
      utf8(JSON.stringify(message)),
    )
  }

  /**
   * Stream a file's bytes as encrypted data frames. The last frame is flagged
   * `isFinal`. A zero-length file still emits one final empty frame so the
   * receiver sees a definite end.
   */
  async sendFile(source: ChunkSource): Promise<void> {
    const total = source.size
    if (total === 0) {
      await this.sendFrame(FrameType.Data, true, new Uint8Array(0))
      this.onProgress?.(0)
      return
    }
    let offset = 0
    while (offset < total) {
      const length = Math.min(this.chunkSize, total - offset)
      const slice = await source.readSlice(offset, length)
      offset += length
      await this.sendFrame(FrameType.Data, offset >= total, slice)
      this.onProgress?.(offset)
    }
  }

  private async sendFrame(
    frameType: FrameType,
    isFinal: boolean,
    plaintext: Uint8Array,
  ): Promise<void> {
    // Allocate the per-direction nonce counter atomically — before any await —
    // so overlapping sends can never read the same seq and reuse a (key, nonce)
    // pair, which would break AES-GCM (CLAUDE.md §4.4).
    const seq = this.seq
    this.seq += 1n
    const header = encodeHeader({
      version: FRAME_VERSION,
      frameType,
      isFinal,
      seq,
    })
    const ciphertext = await encryptChunk(
      {
        key: this.sendKey,
        directionId: this.directionId,
        counter: seq,
        transferId: buildAadContext(this.transferId, FRAME_VERSION, frameType),
        chunkIndex: seq,
        isFinal,
      },
      plaintext,
    )
    await sendWithBackpressure(
      this.channel,
      concatBytes(header, ciphertext),
      this.highWater,
    )
  }
}
