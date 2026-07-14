import type { ChunkSource } from '../transport/sender'

/**
 * Streams a `File` by slicing it on demand (§6C) — never loads the whole file
 * into memory, so multi-GB sends stay flat.
 */
export class FileSource implements ChunkSource {
  readonly size: number
  private readonly file: File

  constructor(file: File) {
    this.file = file
    this.size = file.size
  }

  async readSlice(offset: number, length: number): Promise<Uint8Array> {
    const buffer = await this.file.slice(offset, offset + length).arrayBuffer()
    return new Uint8Array(buffer)
  }
}
