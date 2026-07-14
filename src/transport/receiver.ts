import { decryptChunk } from '../crypto/aead'
import { toHex, utf8Decode } from '../crypto/bytes'
import { createFileHasher, type FileHasher } from '../crypto/hash'
import type { ControlMessage } from '../protocol/messages'
import {
  buildAadContext,
  decodeHeader,
  FRAME_HEADER_LEN,
  FrameType,
} from './frame'

/**
 * Receiver (CLAUDE.md §6E). Decrypts each incoming frame, enforces monotonic
 * `seq` (a gap ⇒ reorder/truncation ⇒ fail closed), reassembles the plaintext
 * to an abstract sink, and streams SHA-256 over the decrypted bytes for the
 * whole-file integrity check (§4.4). Nothing is trusted before the GCM tag
 * verifies, and any error aborts rather than surfacing unverified data (§4.6).
 */

/** A byte sink written sequentially (File System Access stream, OPFS, memory). */
export interface ChunkSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

export type ReceiverEvent =
  | { kind: 'control'; message: ControlMessage }
  | {
      kind: 'data'
      isFinal: boolean
      bytesWritten: number
      /** Present only on the final data frame: hash of the decrypted file. */
      sha256Hex?: string
    }

export interface ReceiverOptions {
  /** This peer's incoming AES-256-GCM key (Session.recvKey). */
  recvKey: CryptoKey
  /** The *peer's* outgoing direction id (Session.recvDirectionId). */
  directionId: number
  /** Transfer id bound into every frame's AAD. */
  transferId: Uint8Array
  sink: ChunkSink
}

export class Receiver {
  private expectedSeq = 0n
  private bytesWritten = 0
  // Per-file hasher: reset on each `isFinal` so `sha256Hex` is the hash of that
  // file, and a multi-file stream (many `isFinal`s) never calls digest() twice.
  private hasher: FileHasher = createFileHasher()
  private readonly recvKey: CryptoKey
  private readonly directionId: number
  private readonly transferId: Uint8Array
  private readonly sink: ChunkSink

  constructor(options: ReceiverOptions) {
    this.recvKey = options.recvKey
    this.directionId = options.directionId
    this.transferId = options.transferId
    this.sink = options.sink
  }

  async handleFrame(frame: Uint8Array): Promise<ReceiverEvent> {
    const header = decodeHeader(frame)
    // Monotonic sequence: no gaps, no replays. Fail closed on any deviation.
    if (header.seq !== this.expectedSeq) {
      throw new Error(
        `receiver: out-of-order frame (expected ${this.expectedSeq}, got ${header.seq})`,
      )
    }

    const ciphertext = frame.subarray(FRAME_HEADER_LEN)
    const plaintext = await decryptChunk(
      {
        key: this.recvKey,
        directionId: this.directionId,
        counter: header.seq,
        transferId: buildAadContext(
          this.transferId,
          header.version,
          header.frameType,
        ),
        chunkIndex: header.seq,
        isFinal: header.isFinal,
      },
      ciphertext,
    )
    this.expectedSeq += 1n

    if (header.frameType === FrameType.Control) {
      return { kind: 'control', message: this.parseControl(plaintext) }
    }

    this.hasher.update(plaintext)
    await this.sink.write(plaintext)
    this.bytesWritten += plaintext.length

    let sha256Hex: string | undefined
    if (header.isFinal) {
      sha256Hex = toHex(this.hasher.digest())
      this.hasher = createFileHasher() // ready for the next file in the stream
    }
    return {
      kind: 'data',
      isFinal: header.isFinal,
      bytesWritten: this.bytesWritten,
      sha256Hex,
    }
  }

  private parseControl(plaintext: Uint8Array): ControlMessage {
    let parsed: unknown
    try {
      parsed = JSON.parse(utf8Decode(plaintext))
    } catch {
      throw new Error('receiver: malformed control message JSON')
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      throw new Error('receiver: control message missing type')
    }
    return parsed as ControlMessage
  }
}
