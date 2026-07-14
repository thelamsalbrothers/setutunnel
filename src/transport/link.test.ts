import { describe, expect, it } from 'vitest'
import { fromHex, toHex, utf8 } from '../crypto/bytes'
import { computeSharedSecret } from '../crypto/keypair'
import { deriveSession, type Session } from '../crypto/session'
import type { DataChannelLike } from './channel'
import { TransportLink } from './link'
import { MemorySink, MemorySource } from './memory'

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

// Records what a peer sends; the test hands these frames to the other peer.
class RecordChannel implements DataChannelLike {
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

async function sessions(): Promise<{ a: Session; b: Session }> {
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

function payload(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = (i * seed + 13) & 0xff
  return out
}

describe('TransportLink — full-duplex transfer', () => {
  it('both peers send AND receive at the same time, byte-for-byte', async () => {
    const { a, b } = await sessions()
    const transferId = utf8('bidir')

    const chA = new RecordChannel()
    const chB = new RecordChannel()
    const sinkA = new MemorySink()
    const sinkB = new MemorySink()

    const linkA = new TransportLink({
      channel: chA,
      session: a,
      transferId,
      sink: sinkA,
      chunkSize: 64 * 1024,
    })
    const linkB = new TransportLink({
      channel: chB,
      session: b,
      transferId,
      sink: sinkB,
      chunkSize: 64 * 1024,
    })

    const aToB = payload(31, 200 * 1024) // A → B, 4 chunks
    const bToA = payload(17, 130 * 1024) // B → A, 3 chunks

    // Both peers stream to each other concurrently.
    await Promise.all([
      linkA.sendFile(new MemorySource(aToB)),
      linkB.sendFile(new MemorySource(bToA)),
    ])

    // Deliver each peer's frames to the other (a real channel does this live).
    for (const frame of chA.frames) await linkB.handleIncoming(frame)
    for (const frame of chB.frames) await linkA.handleIncoming(frame)

    expect(toHex(sinkB.bytes())).toBe(toHex(aToB)) // B got A's file
    expect(toHex(sinkA.bytes())).toBe(toHex(bToA)) // A got B's file
  })

  it('is direction-isolated: a frame cannot be decrypted by its own sender', async () => {
    const { a, b } = await sessions()
    const transferId = utf8('iso')
    const chA = new RecordChannel()
    const linkA = new TransportLink({
      channel: chA,
      session: a,
      transferId,
      sink: new MemorySink(),
    })
    // linkB exists only so A's frames are well-formed for the peer.
    void new TransportLink({
      channel: new RecordChannel(),
      session: b,
      transferId,
      sink: new MemorySink(),
    })

    await linkA.sendFile(new MemorySource(utf8('secret')))
    // Feeding A's own outgoing frame back into A must fail: it was sealed with
    // K_A→B, but A's receiver decrypts with K_B→A.
    await expect(linkA.handleIncoming(chA.frames[0])).rejects.toThrow()
  })

  it('emits onReceive for delivered frames', async () => {
    const { a, b } = await sessions()
    const transferId = utf8('evt')
    const chA = new RecordChannel()
    const linkA = new TransportLink({
      channel: chA,
      session: a,
      transferId,
      sink: new MemorySink(),
    })
    const events: string[] = []
    const linkB = new TransportLink({
      channel: new RecordChannel(),
      session: b,
      transferId,
      sink: new MemorySink(),
      events: { onReceive: (e) => events.push(e.kind) },
    })

    await linkA.sendControl({ type: 'accept', transferId: 'evt' })
    await linkA.sendFile(new MemorySource(utf8('hi')))
    for (const frame of chA.frames) await linkB.handleIncoming(frame)

    expect(events).toEqual(['control', 'data'])
  })
})
