import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8 } from '../crypto/bytes'
import { sha256Once } from '../crypto/hash'
import { computeSharedSecret } from '../crypto/keypair'
import { deriveSession, type Session } from '../crypto/session'
import { buildManifest } from '../protocol/manifest'
import type { DataChannelLike } from './channel'
import { MemorySink, MemorySource } from './memory'
import { Receiver, type ReceiverEvent } from './receiver'
import { Sender } from './sender'

const ALICE_PRIV = fromHex(
  '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
)
const ALICE_PUB = fromHex(
  '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
)
const BOB_PRIV = fromHex(
  '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
)
const BOB_PUB = fromHex(
  'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
)
const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)

// A loopback channel that just records the frames the sender emits, so the
// test can feed them into the receiver deterministically.
class LoopbackChannel implements DataChannelLike {
  readyState: DataChannelLike['readyState'] = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  readonly frames: Uint8Array[] = []
  send(data: Uint8Array): void {
    this.frames.push(data.slice())
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

async function pair(): Promise<{ a: Session; b: Session }> {
  const a = await deriveSession({
    pairingSecret: S,
    sharedSecret: computeSharedSecret(ALICE_PRIV, BOB_PUB),
    roomId: 'room',
    role: 'A',
  })
  const b = await deriveSession({
    pairingSecret: S,
    sharedSecret: computeSharedSecret(BOB_PRIV, ALICE_PUB),
    roomId: 'room',
    role: 'B',
  })
  return { a, b }
}

function makeSender(
  a: Session,
  channel: LoopbackChannel,
  transferId: Uint8Array,
) {
  return new Sender({
    channel,
    sendKey: a.sendKey,
    directionId: a.sendDirectionId,
    transferId,
    chunkSize: 64 * 1024,
  })
}

function makeReceiver(b: Session, sink: MemorySink, transferId: Uint8Array) {
  return new Receiver({
    recvKey: b.recvKey,
    directionId: b.recvDirectionId,
    transferId,
    sink,
  })
}

describe('transport loopback (crypto + framing, end to end)', () => {
  it('transfers a multi-chunk file and reassembles byte-for-byte', async () => {
    const { a, b } = await pair()
    const transferId = utf8('xfer-1')
    const channel = new LoopbackChannel()
    const sender = makeSender(a, channel, transferId)
    const sink = new MemorySink()
    const receiver = makeReceiver(b, sink, transferId)

    const payload = new Uint8Array(200 * 1024) // 4 chunks at 64 KiB
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) & 0xff
    const expectedHash = toHex(await sha256Once(payload))

    const manifest = buildManifest('xfer-1', [
      {
        path: 'blob.bin',
        size: payload.length,
        type: 'application/octet-stream',
      },
    ])
    await sender.sendControl(manifest)
    await sender.sendFile(new MemorySource(payload))
    await sender.sendControl({
      type: 'eof',
      transferId: 'xfer-1',
      fileIndex: 0,
      chunkCount: 4,
      sha256Hex: expectedHash,
    })

    const events: ReceiverEvent[] = []
    for (const frame of channel.frames) {
      events.push(await receiver.handleFrame(frame))
    }

    const first = events[0]
    expect(first.kind).toBe('control')
    if (first.kind === 'control') expect(first.message.type).toBe('manifest')

    // Reassembled bytes are identical to the source.
    expect(toHex(sink.bytes())).toBe(toHex(payload))

    // The final data frame's streaming hash matches the EOF hash.
    const dataEvents = events.filter((e) => e.kind === 'data')
    const last = dataEvents.at(-1)
    expect(last?.kind).toBe('data')
    if (last?.kind === 'data') {
      expect(last.isFinal).toBe(true)
      expect(last.sha256Hex).toBe(expectedHash)
    }

    const eof = events.at(-1)
    if (eof?.kind === 'control' && eof.message.type === 'eof') {
      expect(eof.message.sha256Hex).toBe(expectedHash)
    }
  })

  it('rejects a tampered ciphertext (fail closed)', async () => {
    const { a, b } = await pair()
    const transferId = utf8('xfer-2')
    const channel = new LoopbackChannel()
    const sender = makeSender(a, channel, transferId)
    const receiver = makeReceiver(b, new MemorySink(), transferId)

    await sender.sendFile(new MemorySource(utf8('hello world')))
    channel.frames[0][12] ^= 0x01 // flip a ciphertext bit (byte 11 is header end)

    await expect(receiver.handleFrame(channel.frames[0])).rejects.toThrow()
  })

  it('rejects an out-of-order frame (reorder/truncation)', async () => {
    const { a, b } = await pair()
    const transferId = utf8('xfer-3')
    const channel = new LoopbackChannel()
    const sender = makeSender(a, channel, transferId)
    const receiver = makeReceiver(b, new MemorySink(), transferId)

    await sender.sendControl({ type: 'accept', transferId: 'xfer-3' })
    await sender.sendFile(new MemorySource(utf8('data')))

    // Feed the second frame (seq 1) before the first (seq 0).
    await expect(receiver.handleFrame(channel.frames[1])).rejects.toThrow(
      /out-of-order/,
    )
  })

  it('handles a zero-length file with a single final frame', async () => {
    const { a, b } = await pair()
    const transferId = utf8('xfer-4')
    const channel = new LoopbackChannel()
    const sender = makeSender(a, channel, transferId)
    const sink = new MemorySink()
    const receiver = makeReceiver(b, sink, transferId)

    await sender.sendFile(new MemorySource(new Uint8Array(0)))
    expect(channel.frames).toHaveLength(1)

    const event = await receiver.handleFrame(channel.frames[0])
    expect(event.kind).toBe('data')
    if (event.kind === 'data') {
      expect(event.isFinal).toBe(true)
      expect(event.bytesWritten).toBe(0)
      expect(event.sha256Hex).toBe(toHex(await sha256Once(new Uint8Array(0))))
    }
    expect(sink.bytes()).toHaveLength(0)
  })
})
