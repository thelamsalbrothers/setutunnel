import { concatBytes } from '../crypto/bytes'

/**
 * Transport frame format (CLAUDE.md §4.4, §6D). Every DataChannel message —
 * control *and* data — is app-layer AES-GCM encrypted so metadata (filenames,
 * sizes) stays end-to-end secret even from the DTLS layer. Each direction has
 * one monotonic `seq`; the nonce is `directionId ‖ seq`, so a (key, nonce) pair
 * is never reused.
 *
 * Wire layout of one frame:
 *   header (11 bytes, plaintext but authenticated via AAD):
 *     [0]     version
 *     [1]     frameType (0 = control, 1 = data)
 *     [2]     flags (bit0 = isFinal)
 *     [3..11) seq (u64 BE)
 *   [11..)    AES-256-GCM ciphertext
 *
 * The header is bound into the AAD (see `buildAadContext`) together with the
 * transfer id, so flipping the type/flags/seq on the wire makes decryption
 * fail. This composes on top of Module A's `encryptChunk`/`decryptChunk`
 * without changing their golden-vector'd AAD: the transport passes
 * `transferId ‖ version ‖ frameType` as the primitive's `transferId` argument
 * and `seq` as both the counter and chunkIndex.
 */

export const FRAME_VERSION = 1
export const FRAME_HEADER_LEN = 11

export const FrameType = { Control: 0, Data: 1 } as const
export type FrameType = (typeof FrameType)[keyof typeof FrameType]

export interface FrameHeader {
  version: number
  frameType: FrameType
  isFinal: boolean
  seq: bigint
}

export function encodeHeader(h: FrameHeader): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(FRAME_HEADER_LEN)
  out[0] = h.version
  out[1] = h.frameType
  out[2] = h.isFinal ? 1 : 0
  new DataView(out.buffer).setBigUint64(3, h.seq, false)
  return out
}

export function decodeHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.length < FRAME_HEADER_LEN) {
    throw new Error('frame: shorter than header')
  }
  const version = bytes[0]
  if (version !== FRAME_VERSION) {
    throw new Error(`frame: unsupported version ${version}`)
  }
  const rawType = bytes[1]
  if (rawType !== FrameType.Control && rawType !== FrameType.Data) {
    throw new Error(`frame: unknown frame type ${rawType}`)
  }
  const frameType: FrameType =
    rawType === FrameType.Data ? FrameType.Data : FrameType.Control
  const isFinal = (bytes[2] & 1) === 1
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const seq = view.getBigUint64(3, false)
  return { version, frameType, isFinal, seq }
}

/**
 * AAD context bound into every frame's AES-GCM tag: the transfer id plus the
 * version and frame type. Passed as the `transferId` argument of Module A's
 * encrypt/decrypt so the type and version can't be tampered undetected.
 */
export function buildAadContext(
  transferId: Uint8Array,
  version: number,
  frameType: FrameType,
): Uint8Array<ArrayBuffer> {
  return concatBytes(transferId, Uint8Array.of(version, frameType))
}
