import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { concatBytes } from '../crypto/bytes'
import {
  DEFAULT_STREAM_THRESHOLD,
  fileSystemAccessAvailable,
  pickSaveFile,
  resolveStreamThreshold,
  type WritableFileSink,
  ZipStreamWriter,
} from './file-sink'

function collectingSink() {
  const chunks: Uint8Array[] = []
  const state = { closed: false, aborted: false }
  const sink: WritableFileSink = {
    write: async (chunk) => {
      chunks.push(chunk.slice())
    },
    close: async () => {
      state.closed = true
    },
    abort: async () => {
      state.aborted = true
    },
  }
  return { sink, chunks, state }
}

type Picker = typeof globalThis & { showSaveFilePicker?: unknown }

function stubPicker(impl: unknown): void {
  ;(globalThis as Picker).showSaveFilePicker = impl
}

afterEach(() => {
  ;(globalThis as Picker).showSaveFilePicker = undefined
})

describe('resolveStreamThreshold', () => {
  it('defaults when nothing is set', () => {
    expect(resolveStreamThreshold(null, undefined)).toBe(
      DEFAULT_STREAM_THRESHOLD,
    )
  })

  it('prefers the localStorage override over env', () => {
    expect(resolveStreamThreshold('1024', '999999')).toBe(1024)
  })

  it('falls back to env when there is no override', () => {
    expect(resolveStreamThreshold(null, '2048')).toBe(2048)
  })

  it('ignores non-numeric or negative values', () => {
    expect(resolveStreamThreshold('nope', undefined)).toBe(
      DEFAULT_STREAM_THRESHOLD,
    )
    expect(resolveStreamThreshold('-5', undefined)).toBe(
      DEFAULT_STREAM_THRESHOLD,
    )
    expect(resolveStreamThreshold('  ', '4096')).toBe(4096)
  })

  it('accepts zero (force-stream, used by tests)', () => {
    expect(resolveStreamThreshold('0', undefined)).toBe(0)
  })
})

describe('fileSystemAccessAvailable', () => {
  it('is false without the API and true when present', () => {
    expect(fileSystemAccessAvailable()).toBe(false)
    stubPicker(() => {})
    expect(fileSystemAccessAvailable()).toBe(true)
  })
})

describe('pickSaveFile', () => {
  it('returns null when the API is unavailable', async () => {
    expect(await pickSaveFile('a.bin', 'application/octet-stream')).toBeNull()
  })

  it('opens a streaming sink that writes/close through to the handle', async () => {
    const written: number[] = []
    let closed = false
    let sawName = ''
    stubPicker(async (opts: { suggestedName?: string }) => {
      sawName = opts?.suggestedName ?? ''
      return {
        createWritable: async () => ({
          write: async (data: BufferSource) => {
            const u8 =
              data instanceof Uint8Array
                ? data
                : new Uint8Array(data as ArrayBuffer)
            written.push(...u8)
          },
          close: async () => {
            closed = true
          },
        }),
      }
    })

    const sink = await pickSaveFile('big.bin', 'application/octet-stream')
    if (!sink) throw new Error('expected a sink')
    await sink.write(new Uint8Array([1, 2, 3]))
    await sink.write(new Uint8Array([4, 5]))
    await sink.close()

    expect(sawName).toBe('big.bin')
    expect(written).toEqual([1, 2, 3, 4, 5])
    expect(closed).toBe(true)
  })

  it('returns null when the user cancels (picker throws)', async () => {
    stubPicker(async () => {
      throw new Error('AbortError')
    })
    expect(await pickSaveFile('x.bin', '')).toBeNull()
  })
})

describe('ZipStreamWriter', () => {
  it('streams multiple files as one valid zip, preserving paths', async () => {
    const { sink, chunks, state } = collectingSink()
    const writer = new ZipStreamWriter(sink)
    const enc = new TextEncoder()

    writer.startFile('a.txt')
    await writer.write(enc.encode('hello '))
    await writer.write(enc.encode('world'))
    writer.endFile()

    writer.startFile('sub/b.bin')
    await writer.write(new Uint8Array([1, 2, 3]))
    writer.endFile()

    await writer.finish()

    expect(state.closed).toBe(true)
    const files = unzipSync(concatBytes(...chunks))
    expect(Object.keys(files).sort()).toEqual(['a.txt', 'sub/b.bin'])
    expect(new TextDecoder().decode(files['a.txt'])).toBe('hello world')
    expect(Array.from(files['sub/b.bin'])).toEqual([1, 2, 3])
  })

  it('aborts the underlying sink', async () => {
    const { sink, state } = collectingSink()
    const writer = new ZipStreamWriter(sink)
    writer.startFile('x')
    await writer.write(new Uint8Array([1]))
    await writer.abort()
    expect(state.aborted).toBe(true)
  })
})
