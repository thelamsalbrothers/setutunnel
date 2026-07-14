import { Zip, ZipPassThrough } from 'fflate'
import { asBufferSource } from '../crypto/bytes'
import { createServiceWorkerSink, swStreamingAvailable } from './sw-download'

/**
 * Streaming disk-write for the receiver (CLAUDE.md §6E, tier 1 — File System
 * Access API). For a large single-file receive, decrypted chunks are written
 * *straight to disk* through a `FileSystemWritableFileStream` as they arrive, so
 * the receiver's memory stays flat regardless of file size — a multi-GB transfer
 * no longer has to fit in RAM.
 *
 * Capability-detected and additive: when the API is absent (Firefox/Safari), or
 * the file is small, or it's a multi-file/folder/text transfer, the caller keeps
 * using the in-memory Blob path (tier 4). We never dead-end a browser (§P6).
 *
 * A native save picker only makes sense for genuinely large files, so streaming
 * is gated behind a size threshold — small files still download seamlessly to
 * the Downloads folder without a dialog.
 */

/** A sequential byte sink the receiver streams a whole file into. */
export interface WritableFileSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

/** Minimal shape of the File System Access API bits we use (self-declared so we
 *  don't depend on lib.dom including this still-evolving API). */
interface FsWritable {
  write(data: BufferSource): Promise<void>
  close(): Promise<void>
  abort?(reason?: unknown): Promise<void>
}
interface FsFileHandle {
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritable>
}
type ShowSaveFilePicker = (options?: {
  suggestedName?: string
}) => Promise<FsFileHandle>

/** 256 MiB — above this a single-file receive streams to disk (if supported). */
export const DEFAULT_STREAM_THRESHOLD = 256 * 1024 * 1024

class FsaFileSink implements WritableFileSink {
  private closed = false
  private readonly writable: FsWritable

  constructor(writable: FsWritable) {
    this.writable = writable
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writable.write(asBufferSource(chunk))
  }

  async close(): Promise<void> {
    this.closed = true
    await this.writable.close()
  }

  async abort(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.writable.abort?.()
    } catch {
      // best-effort discard of a partial file; nothing to recover here
    }
  }
}

function picker(): ShowSaveFilePicker | undefined {
  return (globalThis as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker
}

/** True when the browser can stream to disk (Chromium desktop today). */
export function fileSystemAccessAvailable(): boolean {
  return typeof picker() === 'function'
}

/** Any flat-memory disk sink available? File System Access (tier 1) OR a
 *  service-worker streamed download (tier 2, for Firefox/Safari). */
export function streamToDiskAvailable(): boolean {
  return fileSystemAccessAvailable() || swStreamingAvailable()
}

/**
 * Open the best available streaming disk sink: File System Access (tier 1) if
 * present, else a service-worker streamed download (tier 2). Returns null to
 * mean "use the in-memory Blob path" (tier 4) — including when the user cancels
 * the FSA save picker. Call from a user gesture (the Accept click).
 */
export async function openStreamSink(
  filename: string,
  mimeType: string,
  size: number | null,
): Promise<WritableFileSink | null> {
  if (fileSystemAccessAvailable()) {
    return pickSaveFile(filename, mimeType) // null if the user cancels
  }
  if (swStreamingAvailable()) {
    return createServiceWorkerSink(filename, mimeType, size)
  }
  return null
}

/**
 * Pure threshold resolver (testable): a localStorage override wins, then the
 * build-time env, then the default. A non-numeric/negative value is ignored.
 */
export function resolveStreamThreshold(
  override: string | null | undefined,
  envValue: string | undefined,
): number {
  for (const raw of [override, envValue]) {
    if (raw != null && raw.trim() !== '') {
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0) return value
    }
  }
  return DEFAULT_STREAM_THRESHOLD
}

/** The live threshold: `localStorage['setu:streamThreshold']` (a future setting /
 *  test seam) → `VITE_STREAM_THRESHOLD_BYTES` → default. */
export function streamThreshold(): number {
  let override: string | null = null
  try {
    override = globalThis.localStorage?.getItem('setu:streamThreshold') ?? null
  } catch {
    // localStorage may be unavailable (SSR/tests); fall back to env/default
  }
  const envValue = (
    import.meta.env as unknown as { VITE_STREAM_THRESHOLD_BYTES?: string }
  ).VITE_STREAM_THRESHOLD_BYTES
  return resolveStreamThreshold(override, envValue)
}

/**
 * Prompt for a save location and open a streaming sink to it. MUST be called
 * from within a user gesture (the receiver's Accept click). Returns `null` if
 * the API is unavailable or the user cancels — the caller then falls back to the
 * in-memory Blob download, so the transfer still succeeds.
 */
export async function pickSaveFile(
  suggestedName: string,
  _mimeType: string,
): Promise<WritableFileSink | null> {
  const show = picker()
  if (!show) return null
  try {
    const handle = await show({ suggestedName })
    const writable = await handle.createWritable()
    return new FsaFileSink(writable)
  } catch {
    return null // AbortError (user cancelled) or an API failure → fall back
  }
}

/**
 * Streams a **multi-file** archive straight to disk (§6E): each file's chunks
 * are fed into a store-mode zip (fflate `Zip`) whose output is written to the
 * sink as it is produced, so a whole folder is received with flat memory instead
 * of buffering the archive in RAM. The caller drives boundaries —
 * `startFile` → `write`* → `endFile` per file — then `finish()` (or `abort()`).
 * Backpressure: `write` awaits the queued disk writes, tying the network read
 * rate to disk speed.
 */
export class ZipStreamWriter {
  private readonly sink: WritableFileSink
  private readonly zip: Zip
  private current: ZipPassThrough | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private failure: unknown = null

  constructor(sink: WritableFileSink) {
    this.sink = sink
    this.zip = new Zip((err, chunk) => {
      if (err) {
        this.failure ??= err
        return
      }
      this.writeChain = this.writeChain
        .then(() => this.sink.write(chunk))
        .catch((error) => {
          this.failure ??= error
        })
    })
  }

  startFile(path: string): void {
    const entry = new ZipPassThrough(path)
    this.current = entry
    this.zip.add(entry)
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.throwIfFailed()
    this.current?.push(chunk, false)
    await this.writeChain
    this.throwIfFailed()
  }

  endFile(): void {
    this.current?.push(new Uint8Array(0), true)
    this.current = null
  }

  async finish(): Promise<void> {
    this.zip.end()
    await this.writeChain
    this.throwIfFailed()
    await this.sink.close()
  }

  async abort(): Promise<void> {
    try {
      await this.sink.abort()
    } catch {
      // best-effort discard of the partial archive
    }
  }

  private throwIfFailed(): void {
    if (this.failure) {
      throw this.failure instanceof Error
        ? this.failure
        : new Error(String(this.failure))
    }
  }
}
