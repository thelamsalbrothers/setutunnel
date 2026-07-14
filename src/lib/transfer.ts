import { zipSync } from 'fflate'
import { type Connection, connect } from '../connection/orchestrator'
import { concatBytes, utf8Decode } from '../crypto/bytes'
import type { Sas } from '../crypto/sas'
import {
  assessFile,
  buildManifest,
  validateManifest,
} from '../protocol/manifest'
import type { FileEntry, ManifestMessage } from '../protocol/messages'
import {
  buildPairingUrl,
  generatePairing,
  type Pairing,
  parsePairingUrl,
} from '../protocol/pairing'
import { generateShortCode, parseShortCode } from '../protocol/shortcode'
import { SignalingClient } from '../signaling/client'
import { TransportLink } from '../transport/link'
import type { ChunkSink, ReceiverEvent } from '../transport/receiver'
import { createWebRtcConnector } from '../transport/webrtc'
import { SIGNALING_URL } from './config'
import { downloadBlob } from './download'
import {
  openStreamSink,
  streamThreshold,
  streamToDiskAvailable,
  type WritableFileSink,
  ZipStreamWriter,
} from './file-sink'
import { FileSource } from './file-source'
import { loadIceServers } from './ice'

/**
 * Drives one transfer, translating the engine into a small observable state the
 * UI subscribes to. Sender (room creator, role A) offers one or more files;
 * receiver (link opener, role B) consents and downloads.
 *
 * Multi-file: all files are announced up front in a single manifest, then
 * streamed back-to-back over the one link. Each file's last frame carries the
 * `isFinal` flag, so the receiver delimits files by counting those — no
 * wire-format change, and the monotonic per-direction seq still covers order.
 */

export type Phase =
  | 'idle'
  | 'creating'
  | 'waiting' // sender: link is shown, waiting for the other device
  | 'connecting' // receiver: joining + handshaking
  | 'consent' // sender: awaiting accept · receiver: reviewing the files
  | 'transferring'
  | 'complete'
  | 'declined'
  | 'error'

export interface FileInfo {
  name: string
  size: number
  type: string
}

/** How the two peers pair: a link/QR (secret in the URL) or a spoken short code. */
export type PairingMode = 'link' | 'code'

export interface TransferSnapshot {
  role: 'sender' | 'receiver'
  phase: Phase
  /** 'text' ⇒ a pasted snippet shown inline; 'files' ⇒ downloaded. */
  kind: 'files' | 'text'
  pairingMode: PairingMode
  sas: Sas | null
  link: string | null
  /** Short-code (sender): the code to read to the other person, e.g. `742-otter-anvil`. */
  code: string | null
  files: FileInfo[]
  /** Index of the file currently being sent/received (for "file X of Y"). */
  currentIndex: number
  danger: string[]
  bytes: number // aggregate across all files
  total: number // sum of all file sizes
  speed: number
  /** The shared text (sender: what was sent; receiver: what arrived). */
  text: string | null
  error: string | null
}

export function tryParsePairing(): Pairing | null {
  try {
    return parsePairingUrl(window.location.href)
  } catch {
    return null
  }
}

type Listener = (snapshot: TransferSnapshot) => void

function noopSink(): ChunkSink {
  return { async write() {}, async close() {} }
}

function toInfo(entry: FileEntry): FileInfo {
  return { name: entry.path, size: entry.size, type: entry.type }
}

/** Last path segment, e.g. 'folder/sub/a.txt' → 'a.txt'. */
function baseName(path: string): string {
  return path.split('/').pop() || path
}

export class TransferController {
  private snapshot: TransferSnapshot
  private readonly listeners = new Set<Listener>()
  private client: SignalingClient | null = null
  private connection: Connection | null = null
  private link: TransportLink | null = null
  private transferId = ''

  // Sender
  private outgoing: File[] = []
  private completedBytes = 0
  private sending = false

  // Receiver
  private currentParts: Uint8Array[] = []
  private receiveIndex = 0
  private expectedSizes: number[] = []
  private received: Array<{ path: string; type: string; bytes: Uint8Array }> =
    []
  private accepted = false
  // Streaming disk-write (§6E, tier 1). When active, decrypted chunks go
  // straight to disk instead of accumulating in `currentParts`: 'file' streams a
  // single file to a FileSystemWritableFileStream; 'zip' streams a multi-file
  // archive to disk as it arrives (flat memory for folders too).
  private streamMode: 'none' | 'file' | 'zip' = 'none'
  private fileSink: WritableFileSink | null = null
  private zipWriter: ZipStreamWriter | null = null
  private streamedBytes = 0 // bytes of the *current* file streamed so far

  // The pairing secret S — retained only so teardown can zeroize it (§4.6).
  private secret: Uint8Array | null = null
  private disposed = false

  private startedAt = 0

  constructor(role: 'sender' | 'receiver') {
    this.snapshot = {
      role,
      phase: 'idle',
      kind: 'files',
      pairingMode: 'link',
      sas: null,
      link: null,
      code: null,
      files: [],
      currentIndex: 0,
      danger: [],
      bytes: 0,
      total: 0,
      speed: 0,
      text: null,
      error: null,
    }
  }

  get state(): TransferSnapshot {
    return this.snapshot
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private patch(partial: Partial<TransferSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private progress(bytes: number): void {
    if (this.startedAt === 0) this.startedAt = performance.now()
    const elapsed = (performance.now() - this.startedAt) / 1000
    this.patch({ bytes, speed: elapsed > 0 ? bytes / elapsed : 0 })
  }

  private fail(error: unknown): void {
    this.patch({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    this.teardown()
  }

  private teardown(): void {
    this.client?.close()
    this.connection?.close()
    this.client = null
    // Discard any half-written streamed output (fail-closed: no partial left).
    if (this.fileSink) {
      void this.fileSink.abort()
      this.fileSink = null
    }
    if (this.zipWriter) {
      void this.zipWriter.abort()
      this.zipWriter = null
    }
    // Zeroize key material; drop plaintext buffers for GC (§4.6).
    this.secret?.fill(0)
    this.secret = null
    this.currentParts = []
    this.received = []
  }

  /**
   * Release the peer connection, abort any in-flight streamed file, and zeroize
   * key material — on tab close / navigation (§6B). Idempotent; safe to call from
   * `pagehide`/`beforeunload` and again on unmount.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.teardown()
  }

  private handleDisconnect(): void {
    const phase = this.snapshot.phase
    if (phase === 'complete' || phase === 'declined' || phase === 'error')
      return
    this.fail(new Error('the other device disconnected'))
  }

  // ---- Sender ----
  startSend(files: File[], pairing: PairingMode = 'link'): Promise<void> {
    return this.beginSend(files, 'files', pairing)
  }

  startSendText(text: string, pairing: PairingMode = 'link'): Promise<void> {
    const bytes = new TextEncoder().encode(text)
    const file = new File([bytes], 'shared-text.txt', { type: 'text/plain' })
    this.patch({ text })
    return this.beginSend([file], 'text', pairing)
  }

  private async beginSend(
    files: File[],
    kind: 'files' | 'text',
    pairingMode: PairingMode,
  ): Promise<void> {
    if (files.length === 0) return
    this.outgoing = files
    const entries: FileEntry[] = files.map((file) => ({
      // Folder picks carry their relative path so structure survives in the zip.
      path: file.webkitRelativePath || file.name,
      size: file.size,
      type: file.type,
    }))
    const total = entries.reduce((sum, entry) => sum + entry.size, 0)
    this.patch({
      phase: 'creating',
      kind,
      pairingMode,
      files: entries.map(toInfo),
      total,
    })

    try {
      // Pick the rendezvous + how the receiver will authenticate: a link with S
      // in the URL fragment, or a spoken short code driving SPAKE2 (§4.3).
      let roomId: string
      let auth: { pairingSecret?: Uint8Array; pakeCode?: string }
      let display: Partial<TransferSnapshot>
      if (pairingMode === 'code') {
        const code = generateShortCode()
        const parsed = parseShortCode(code)
        roomId = parsed.roomId
        auth = { pakeCode: parsed.password }
        display = { code }
      } else {
        const pairing = generatePairing()
        roomId = pairing.roomId
        this.secret = pairing.secret
        // Hand connect() its own copy: teardown zeroizes `this.secret` (§4.6),
        // and connect still reads S after an await, so they must not alias.
        auth = { pairingSecret: pairing.secret.slice() }
        display = { link: buildPairingUrl(window.location.origin, pairing) }
      }
      this.transferId = roomId

      this.client = new SignalingClient(SIGNALING_URL)
      const [, iceServers] = await Promise.all([
        this.client.connect(),
        loadIceServers(), // fetches an ephemeral TURN cred if configured (§5)
      ])
      this.patch({ phase: 'waiting', ...display })

      const connection = await connect({
        role: 'A',
        roomId,
        ...auth,
        signaling: this.client,
        connector: createWebRtcConnector('A', {
          iceServers,
          onDisconnect: () => this.handleDisconnect(),
        }),
        sink: noopSink(),
        events: {
          onReceive: (event) => this.onSenderControl(event),
          onSendProgress: (bytes) => this.progress(this.completedBytes + bytes),
        },
        onReceiveError: (error) => this.fail(error),
      })
      this.connection = connection
      this.link = connection.link
      this.client.close() // signaling done; P2P is up (§3)
      this.client = null

      // Offer the payload; wait for consent before streaming.
      this.patch({ sas: connection.sas, phase: 'consent' })
      await connection.link.sendControl({
        ...buildManifest(roomId, entries),
        kind,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private async onSenderControl(event: ReceiverEvent): Promise<void> {
    if (event.kind !== 'control') return
    if (event.message.type === 'accept' && this.link && !this.sending) {
      this.sending = true // ignore a duplicate accept (would interleave sends)
      this.patch({ phase: 'transferring' })
      this.startedAt = performance.now()
      try {
        for (let i = 0; i < this.outgoing.length; i++) {
          this.patch({ currentIndex: i })
          const file = this.outgoing[i]
          await this.link.sendFile(new FileSource(file))
          this.completedBytes += file.size
        }
        this.patch({
          phase: 'complete',
          bytes: this.snapshot.total,
          currentIndex: this.outgoing.length,
        })
        // Do NOT close the connection here: sendFile resolves once frames are
        // buffered, not delivered. Closing now would drop the in-flight tail.
        // It closes on navigation.
      } catch (error) {
        this.fail(error)
      }
    } else if (event.message.type === 'reject') {
      this.patch({ phase: 'declined' })
      this.teardown()
    }
  }

  // ---- Receiver ----
  /** Receive via a link/QR pairing (secret S from the URL fragment). */
  startReceive(pairing: Pairing): Promise<void> {
    this.secret = pairing.secret
    // connect() gets its own copy so teardown's zeroize can't corrupt it (§4.6).
    return this.beginReceive('link', pairing.roomId, {
      pairingSecret: pairing.secret.slice(),
    })
  }

  /** Receive via a typed short code (SPAKE2 password). */
  async startReceiveWithCode(code: string): Promise<void> {
    let parsed: ReturnType<typeof parseShortCode>
    try {
      parsed = parseShortCode(code)
    } catch (error) {
      this.patch({ phase: 'connecting', pairingMode: 'code' })
      this.fail(error)
      return
    }
    return this.beginReceive('code', parsed.roomId, {
      pakeCode: parsed.password,
    })
  }

  private async beginReceive(
    pairingMode: PairingMode,
    roomId: string,
    auth: { pairingSecret?: Uint8Array; pakeCode?: string },
  ): Promise<void> {
    this.transferId = roomId
    this.patch({ phase: 'connecting', pairingMode })
    try {
      this.client = new SignalingClient(SIGNALING_URL)
      const [, iceServers] = await Promise.all([
        this.client.connect(),
        loadIceServers(), // fetches an ephemeral TURN cred if configured (§5)
      ])

      const sink: ChunkSink = {
        write: (chunk) => this.consumeChunk(chunk),
        close: async () => {},
      }

      const connection = await connect({
        role: 'B',
        roomId,
        ...auth,
        signaling: this.client,
        connector: createWebRtcConnector('B', {
          iceServers,
          onDisconnect: () => this.handleDisconnect(),
        }),
        sink,
        events: { onReceive: (event) => this.onReceiverEvent(event) },
        onReceiveError: (error) => this.fail(error),
      })
      this.connection = connection
      this.link = connection.link
      this.client.close()
      this.client = null
      this.patch({ sas: connection.sas })
    } catch (error) {
      this.fail(error)
    }
  }

  private onReceiverEvent(event: ReceiverEvent): void {
    if (event.kind === 'control') {
      if (event.message.type === 'manifest') {
        // The peer is untrusted (§4.7): validate caps + sanitize paths on the
        // *receiving* side too, and fail closed on anything malformed. Also
        // reject a duplicate/late manifest — the first one arrives while we're
        // still 'connecting'; a second would desync the in-progress receive.
        if (this.snapshot.phase !== 'connecting') {
          this.fail(new Error('unexpected manifest after the transfer began'))
          return
        }
        let manifest: ManifestMessage
        try {
          manifest = validateManifest(event.message)
        } catch (error) {
          this.fail(error)
          return
        }
        this.expectedSizes = manifest.files.map((file) => file.size)
        this.patch({
          phase: 'consent',
          kind: manifest.kind === 'text' ? 'text' : 'files',
          files: manifest.files.map(toInfo),
          total: manifest.totalBytes,
          danger: this.assessAll(manifest.files),
        })
      }
      return
    }

    if (this.snapshot.phase !== 'transferring') {
      this.patch({ phase: 'transferring' })
    }
    this.progress(event.bytesWritten)

    if (event.isFinal) {
      // Streaming paths: write straight to disk, no in-RAM buffering.
      if (this.streamMode === 'file') {
        void this.finishStreamedFile()
        return
      }
      if (this.streamMode === 'zip') {
        void this.advanceStreamedZip()
        return
      }
      const file = this.snapshot.files[this.receiveIndex]
      const received = this.currentParts.reduce((n, part) => n + part.length, 0)
      const expected = this.expectedSizes[this.receiveIndex]
      if (received !== expected) {
        this.fail(
          new Error(
            `${file?.name ?? 'file'}: got ${received} bytes, manifest said ${expected}`,
          ),
        )
        return
      }
      const bytes = concatBytes(...this.currentParts)
      this.currentParts = []
      if (this.snapshot.kind === 'text') {
        // A pasted snippet: show it inline (with copy), never a file download.
        this.patch({ text: utf8Decode(bytes) })
      } else {
        this.received.push({
          path: file?.name ?? `file-${this.receiveIndex}`,
          type: file?.type ?? '',
          bytes,
        })
      }
      this.receiveIndex += 1
      this.patch({ currentIndex: this.receiveIndex })
      if (this.receiveIndex >= this.snapshot.files.length) {
        this.deliver()
        this.patch({ phase: 'complete', bytes: this.snapshot.total })
        this.teardown()
      }
    }
  }

  /** Route one decrypted chunk: straight to disk when streaming, else buffer. */
  private consumeChunk(chunk: Uint8Array): Promise<void> {
    if (this.streamMode === 'file' && this.fileSink) {
      this.streamedBytes += chunk.length
      return this.fileSink.write(chunk)
    }
    if (this.streamMode === 'zip' && this.zipWriter) {
      this.streamedBytes += chunk.length
      return this.zipWriter.write(chunk)
    }
    this.currentParts.push(chunk.slice())
    return Promise.resolve()
  }

  /** Fail closed if the current file's streamed byte count ≠ the manifest. */
  private streamedCountOk(): boolean {
    const idx = this.receiveIndex
    const expected = this.expectedSizes[idx] ?? 0
    if (this.streamedBytes === expected) return true
    const name = this.snapshot.files[idx]?.name ?? 'file'
    this.fail(
      new Error(
        `${name}: got ${this.streamedBytes} bytes, manifest said ${expected}`,
      ),
    )
    return false
  }

  /**
   * Finish a streamed single-file receive: verify the byte count against the
   * manifest (fail closed, discarding the partial file), then flush the disk
   * stream. Only reached in 'file' stream mode (FSA tier).
   */
  private async finishStreamedFile(): Promise<void> {
    if (!this.streamedCountOk()) return
    try {
      await this.fileSink?.close()
    } catch (error) {
      this.fail(error)
      return
    }
    this.fileSink = null
    this.streamMode = 'none'
    this.patch({
      phase: 'complete',
      bytes: this.snapshot.total,
      currentIndex: this.snapshot.files.length,
    })
    this.teardown()
  }

  /**
   * A file finished in 'zip' stream mode: validate its byte count, close its zip
   * entry, and either start the next file's entry or, on the last file, finalize
   * and flush the archive. The synchronous prefix (endFile → startFile) MUST run
   * before the next file's first chunk — it does, because the receiver serializes
   * frames and delivers this `isFinal` event before the next frame's data.
   */
  private async advanceStreamedZip(): Promise<void> {
    if (!this.streamedCountOk()) return
    try {
      this.zipWriter?.endFile()
    } catch (error) {
      this.fail(error)
      return
    }
    this.receiveIndex += 1
    this.patch({ currentIndex: this.receiveIndex })

    if (this.receiveIndex < this.snapshot.files.length) {
      const next = this.snapshot.files[this.receiveIndex]
      if (next) this.zipWriter?.startFile(next.name)
      this.streamedBytes = 0
      return
    }

    try {
      await this.zipWriter?.finish()
    } catch (error) {
      this.fail(error)
      return
    }
    this.zipWriter = null
    this.streamMode = 'none'
    this.patch({ phase: 'complete', bytes: this.snapshot.total })
    this.teardown()
  }

  /**
   * Save the received payload once every file is in. A single file downloads as
   * itself; several files (or a folder) are bundled into one .zip — this both
   * preserves folder structure and avoids the browser blocking N separate
   * downloads. Text is already shown inline. (Large single files instead stream
   * to disk via `finishStreamedFile`; this is the in-memory path.)
   */
  private deliver(): void {
    if (this.snapshot.kind === 'text') return
    const files = this.received
    this.received = []
    if (files.length === 1) {
      const only = files[0]
      downloadBlob([only.bytes], baseName(only.path), only.type)
    } else if (files.length > 1) {
      const entries: Record<string, Uint8Array> = {}
      for (const file of files) entries[file.path] = file.bytes
      downloadBlob([zipSync(entries)], 'setutunnel.zip', 'application/zip')
    }
  }

  private assessAll(entries: FileEntry[]): string[] {
    const reasons: string[] = []
    for (const entry of entries) {
      const verdict = assessFile(entry)
      for (const reason of verdict.reasons) {
        reasons.push(entries.length > 1 ? `${entry.path}: ${reason}` : reason)
      }
    }
    return reasons
  }

  accept(): void {
    if (this.accepted) return // idempotent: one accept per transfer
    this.accepted = true
    void this.beginAccept()
  }

  /**
   * On accept: for a large single-file receive on a capable browser, open a
   * streaming disk sink (§6E) so it never buffers in RAM — the save picker MUST
   * be called synchronously within this click's user activation, so this runs
   * before we ACK. Falls back to the in-memory path if unsupported or cancelled.
   */
  private async beginAccept(): Promise<void> {
    this.startedAt = performance.now()
    const files = this.snapshot.files
    const first = files[0]
    const canStream =
      this.snapshot.kind === 'files' &&
      first !== undefined &&
      streamToDiskAvailable() &&
      this.snapshot.total >= streamThreshold()

    if (canStream && files.length === 1) {
      // Single large file → stream directly to disk (FSA or SW download).
      const sink = await openStreamSink(
        baseName(first.name),
        first.type,
        first.size,
      )
      if (sink) {
        this.fileSink = sink
        this.streamMode = 'file'
      }
    } else if (canStream && files.length > 1) {
      // Multi-file / folder → stream one .zip to disk as files arrive. Zip size
      // isn't known ahead of time, so no content-length (chunked download).
      const sink = await openStreamSink(
        'setutunnel.zip',
        'application/zip',
        null,
      )
      if (sink) {
        this.zipWriter = new ZipStreamWriter(sink)
        this.zipWriter.startFile(first.name)
        this.streamMode = 'zip'
        this.streamedBytes = 0
      }
    }
    void this.link?.sendControl({ type: 'accept', transferId: this.transferId })
  }

  decline(): void {
    void this.link?.sendControl({ type: 'reject', transferId: this.transferId })
    this.patch({ phase: 'declined' })
    this.teardown()
  }
}
