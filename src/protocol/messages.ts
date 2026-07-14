/**
 * App-layer DataChannel messages (CLAUDE.md §3, §4.4). Control messages are the
 * discriminated union below; file bytes travel as separate binary chunk frames
 * (see the transport layer). Everything is carried inside the app-layer
 * AES-GCM envelope so filenames/sizes/types stay encrypted end-to-end (§4.4) —
 * these types describe the *plaintext* shapes, before that envelope.
 */

/** One file in a transfer manifest. `path` is a sanitized relative path. */
export interface FileEntry {
  path: string
  size: number
  type: string
}

/** Encrypted manifest: what the sender proposes, shown to the receiver for
 * consent before anything hits disk (§4.7). */
export interface ManifestMessage {
  type: 'manifest'
  transferId: string
  files: FileEntry[]
  totalBytes: number
  chunkSize: number
  /** 'text' ⇒ a pasted snippet the receiver shows inline; default 'files'. */
  kind?: 'files' | 'text'
}

/** Receiver consents; nothing is written before this (§4.7). */
export interface AcceptMessage {
  type: 'accept'
  transferId: string
}

export interface RejectMessage {
  type: 'reject'
  transferId: string
  reason?: string
}

/** Cumulative ACK: highest contiguous chunk index the receiver has committed.
 * Drives the sender's resume window (§6C, §6D). */
export interface AckMessage {
  type: 'ack'
  transferId: string
  ackIndex: number
}

/** End of file: authenticated whole-file hash + chunk count to validate
 * against (§4.4). */
export interface EofMessage {
  type: 'eof'
  transferId: string
  fileIndex: number
  chunkCount: number
  sha256Hex: string
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ControlMessage =
  | ManifestMessage
  | AcceptMessage
  | RejectMessage
  | AckMessage
  | EofMessage
  | ErrorMessage

export type ControlMessageType = ControlMessage['type']
