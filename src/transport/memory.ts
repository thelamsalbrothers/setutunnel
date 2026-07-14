import { concatBytes } from '../crypto/bytes'
import type { ChunkSink } from './receiver'
import type { ChunkSource } from './sender'

/**
 * In-memory source/sink (CLAUDE.md §6E fallback 4: small files only). Also the
 * substrate for the transport loopback tests. Real transfers prefer a File
 * source and a File System Access / OPFS sink; these keep everything in RAM.
 */

export class MemorySource implements ChunkSource {
  readonly size: number
  private readonly data: Uint8Array
  constructor(data: Uint8Array) {
    this.data = data
    this.size = data.length
  }
  async readSlice(offset: number, length: number): Promise<Uint8Array> {
    return this.data.subarray(offset, offset + length)
  }
}

export class MemorySink implements ChunkSink {
  private readonly parts: Uint8Array[] = []
  private closed = false

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('MemorySink: write after close')
    // Copy: a subarray may be a view over a buffer the caller reuses.
    this.parts.push(chunk.slice())
  }

  async close(): Promise<void> {
    this.closed = true
  }

  /** Concatenate everything written so far. */
  bytes(): Uint8Array<ArrayBuffer> {
    return concatBytes(...this.parts)
  }
}
