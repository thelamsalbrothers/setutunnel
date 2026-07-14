import { asBufferSource, concatBytes, u32be, u64be } from './bytes'

/**
 * Per-chunk AES-256-GCM (CLAUDE.md §4.4) with strict nonce and AAD discipline:
 *
 *   nonce (96-bit) = directionId(4B) ‖ counter(8B)   — never reused per key
 *   AAD            = transferId ‖ chunkIndex(8B) ‖ isFinal(1B)
 *
 * Binding position into the AAD makes reorder, replay, and truncation attacks
 * fail the GCM auth check. Decryption fails closed: a bad tag or mismatched AAD
 * throws and we never return unverified plaintext (§4.6, §9).
 */

const GCM = 'AES-GCM'
const TAG_LENGTH = 128

export interface ChunkParams {
  /** Direction-scoped AES-256-GCM key (Session.sendKey / Session.recvKey). */
  key: CryptoKey
  /** 4-byte direction id for the nonce prefix. */
  directionId: number
  /** Monotonic per-direction counter; a (key, counter) pair is never reused. */
  counter: bigint
  /** Transfer id bound into the AAD. */
  transferId: Uint8Array
  /** Chunk position bound into the AAD. */
  chunkIndex: bigint
  /** Whether this is the final chunk, bound into the AAD. */
  isFinal: boolean
}

function buildNonce(
  directionId: number,
  counter: bigint,
): Uint8Array<ArrayBuffer> {
  return concatBytes(u32be(directionId), u64be(counter))
}

function buildAad(
  transferId: Uint8Array,
  chunkIndex: bigint,
  isFinal: boolean,
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    transferId,
    u64be(chunkIndex),
    Uint8Array.of(isFinal ? 1 : 0),
  )
}

export async function encryptChunk(
  params: ChunkParams,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    {
      name: GCM,
      iv: buildNonce(params.directionId, params.counter),
      additionalData: buildAad(
        params.transferId,
        params.chunkIndex,
        params.isFinal,
      ),
      tagLength: TAG_LENGTH,
    },
    params.key,
    asBufferSource(plaintext),
  )
  return new Uint8Array(ct)
}

export async function decryptChunk(
  params: ChunkParams,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    {
      name: GCM,
      iv: buildNonce(params.directionId, params.counter),
      additionalData: buildAad(
        params.transferId,
        params.chunkIndex,
        params.isFinal,
      ),
      tagLength: TAG_LENGTH,
    },
    params.key,
    asBufferSource(ciphertext),
  )
  return new Uint8Array(pt)
}
