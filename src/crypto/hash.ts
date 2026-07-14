import { sha256 } from '@noble/hashes/sha2'
import { asBufferSource } from './bytes'

/**
 * Whole-file integrity (CLAUDE.md §4.4): the receiver streams SHA-256 over the
 * decrypted plaintext and compares it to the hash carried in the authenticated
 * EOF message. Web Crypto's `digest` is one-shot only, so the incremental
 * hasher uses the audited @noble/hashes implementation — an explicit "audited
 * library where Web Crypto lacks coverage" case (§4.6).
 */
export interface FileHasher {
  update(chunk: Uint8Array): void
  digest(): Uint8Array
}

export function createFileHasher(): FileHasher {
  const h = sha256.create()
  return {
    update(chunk) {
      h.update(chunk)
    },
    digest() {
      return h.digest()
    },
  }
}

/** One-shot SHA-256 via Web Crypto (§4.6) — for small, in-memory buffers. */
export async function sha256Once(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(data))
  return new Uint8Array(digest)
}
