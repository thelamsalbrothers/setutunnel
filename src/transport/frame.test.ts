import { describe, expect, it } from 'vitest'
import { utf8 } from '../crypto/bytes'
import {
  buildAadContext,
  decodeHeader,
  encodeHeader,
  FRAME_HEADER_LEN,
  FRAME_VERSION,
  FrameType,
} from './frame'

describe('frame header', () => {
  it('round-trips a header', () => {
    const h = {
      version: FRAME_VERSION,
      frameType: FrameType.Data,
      isFinal: true,
      seq: 123456789n,
    }
    expect(decodeHeader(encodeHeader(h))).toEqual(h)
  })

  it('encodes exactly the header length', () => {
    const bytes = encodeHeader({
      version: FRAME_VERSION,
      frameType: FrameType.Control,
      isFinal: false,
      seq: 0n,
    })
    expect(bytes).toHaveLength(FRAME_HEADER_LEN)
  })

  it('round-trips a full 64-bit seq', () => {
    const seq = 18446744073709551615n // 2^64 - 1
    const dec = decodeHeader(
      encodeHeader({
        version: FRAME_VERSION,
        frameType: FrameType.Data,
        isFinal: false,
        seq,
      }),
    )
    expect(dec.seq).toBe(seq)
  })

  it('decodes from a subarray with a nonzero byteOffset', () => {
    const h = encodeHeader({
      version: FRAME_VERSION,
      frameType: FrameType.Data,
      isFinal: true,
      seq: 9n,
    })
    const padded = new Uint8Array(FRAME_HEADER_LEN + 4)
    padded.set(h, 4)
    expect(decodeHeader(padded.subarray(4)).seq).toBe(9n)
  })

  it('rejects a short buffer', () => {
    expect(() => decodeHeader(new Uint8Array(5))).toThrow()
  })

  it('rejects an unsupported version', () => {
    const h = encodeHeader({
      version: FRAME_VERSION,
      frameType: FrameType.Data,
      isFinal: false,
      seq: 0n,
    })
    h[0] = 99
    expect(() => decodeHeader(h)).toThrow(/version/)
  })

  it('rejects an unknown frame type', () => {
    const h = encodeHeader({
      version: FRAME_VERSION,
      frameType: FrameType.Data,
      isFinal: false,
      seq: 0n,
    })
    h[1] = 7
    expect(() => decodeHeader(h)).toThrow(/type/)
  })

  it('buildAadContext appends version + frameType', () => {
    const ctx = buildAadContext(utf8('t'), FRAME_VERSION, FrameType.Data)
    expect(ctx).toHaveLength(1 + 2)
    expect(ctx[1]).toBe(FRAME_VERSION)
    expect(ctx[2]).toBe(FrameType.Data)
  })
})
