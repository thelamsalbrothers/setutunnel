import { describe, expect, it } from 'vitest'
import { fromHex, utf8, utf8Decode } from '../crypto/bytes'
import type { DataChannelLike } from '../transport/channel'
import { MemorySink, MemorySource } from '../transport/memory'
import { connect } from './orchestrator'
import type {
  DuplexChannel,
  PeerConnector,
  SessionDescription,
  SignalingChannel,
} from './types'

const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)

/**
 * Two cross-wired signaling channels that model the real server: A creates,
 * B joins (which notifies A), and each side's relays reach the other.
 */
function makeSignalingPair(): { a: SignalingChannel; b: SignalingChannel } {
  let markCreated: () => void = () => {}
  const created = new Promise<void>((resolve) => {
    markCreated = resolve
  })
  const a: SignalingChannel = {
    async create() {
      markCreated()
    },
    async join() {
      throw new Error('A is the creator')
    },
    sendRelay(payload) {
      queueMicrotask(() => b.onRelay?.(payload))
    },
  }
  const b: SignalingChannel = {
    async create() {
      throw new Error('B is the joiner')
    },
    async join() {
      await created
      queueMicrotask(() => a.onPeerJoined?.())
    },
    sendRelay(payload) {
      queueMicrotask(() => a.onRelay?.(payload))
    },
  }
  return { a, b }
}

/** A pair of DataChannels wired to each other (delivery is synchronous so the
 *  test can await `whenIdle` deterministically). */
class PairedChannel implements DuplexChannel {
  readyState: DataChannelLike['readyState'] = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  peer: PairedChannel | null = null
  private handler: ((frame: Uint8Array) => void) | null = null
  send(frame: Uint8Array): void {
    this.peer?.handler?.(frame.slice())
  }
  onMessage(handler: (frame: Uint8Array) => void): void {
    this.handler = handler
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

function makeConnectorPair(): { a: PeerConnector; b: PeerConnector } {
  const chA = new PairedChannel()
  const chB = new PairedChannel()
  chA.peer = chB
  chB.peer = chA
  const offer: SessionDescription = { type: 'offer', sdp: 'A-offer' }
  const answer: SessionDescription = { type: 'answer', sdp: 'B-answer' }
  const a: PeerConnector = {
    async offer() {
      return offer
    },
    async answer() {
      throw new Error('A is the offerer')
    },
    async accept() {},
    async channel() {
      return chA
    },
    close() {},
  }
  const b: PeerConnector = {
    async offer() {
      throw new Error('B is the answerer')
    },
    async answer() {
      return answer
    },
    async accept() {
      throw new Error('B does not accept')
    },
    async channel() {
      return chB
    },
    close() {},
  }
  return { a, b }
}

describe('connect() — full handshake over fakes with real crypto', () => {
  it('both peers derive the same SAS and transfer files both ways', async () => {
    const { a: sigA, b: sigB } = makeSignalingPair()
    const { a: connA, b: connB } = makeConnectorPair()
    const sinkA = new MemorySink()
    const sinkB = new MemorySink()
    const roomId = 'room-1'

    const [peerA, peerB] = await Promise.all([
      connect({
        role: 'A',
        roomId,
        pairingSecret: S,
        signaling: sigA,
        connector: connA,
        sink: sinkA,
      }),
      connect({
        role: 'B',
        roomId,
        pairingSecret: S,
        signaling: sigB,
        connector: connB,
        sink: sinkB,
      }),
    ])

    // The SAS matches on both ends — the MITM check (§4.3).
    expect(peerA.sas.number).toBe(peerB.sas.number)
    expect(peerA.sas.emoji).toEqual(peerB.sas.emoji)

    // A → B.
    await peerA.link.sendFile(new MemorySource(utf8('file from A')))
    await peerB.link.whenIdle()
    expect(utf8Decode(sinkB.bytes())).toBe('file from A')

    // B → A, on the same connection.
    await peerB.link.sendFile(new MemorySource(utf8('file from B')))
    await peerA.link.whenIdle()
    expect(utf8Decode(sinkA.bytes())).toBe('file from B')
  })

  it('short-code (SPAKE2) mode: the same code derives the same SAS and transfers', async () => {
    const { a: sigA, b: sigB } = makeSignalingPair()
    const { a: connA, b: connB } = makeConnectorPair()
    const sinkA = new MemorySink()
    const sinkB = new MemorySink()
    const roomId = 'room-code'
    const code = '7-otter-anvil'

    const [peerA, peerB] = await Promise.all([
      connect({
        role: 'A',
        roomId,
        pakeCode: code,
        signaling: sigA,
        connector: connA,
        sink: sinkA,
      }),
      connect({
        role: 'B',
        roomId,
        pakeCode: code,
        signaling: sigB,
        connector: connB,
        sink: sinkB,
      }),
    ])

    expect(peerA.sas.number).toBe(peerB.sas.number)
    expect(peerA.sas.emoji).toEqual(peerB.sas.emoji)

    await peerA.link.sendFile(new MemorySource(utf8('hi from A')))
    await peerB.link.whenIdle()
    expect(utf8Decode(sinkB.bytes())).toBe('hi from A')
  })

  it('short-code mode rejects a mismatched code (fails closed at the envelope)', async () => {
    const { a: sigA, b: sigB } = makeSignalingPair()
    const { a: connA, b: connB } = makeConnectorPair()
    const attempt = Promise.all([
      connect({
        role: 'A',
        roomId: 'room-code',
        pakeCode: 'right-code',
        signaling: sigA,
        connector: connA,
        sink: new MemorySink(),
      }),
      connect({
        role: 'B',
        roomId: 'room-code',
        pakeCode: 'wrong-code',
        signaling: sigB,
        connector: connB,
        sink: new MemorySink(),
      }),
    ])
    await expect(attempt).rejects.toThrow()
  })

  it('rejects when the two peers use different pairing secrets', async () => {
    const { a: sigA, b: sigB } = makeSignalingPair()
    const { a: connA, b: connB } = makeConnectorPair()
    const wrong = fromHex('ff'.repeat(32))

    // B cannot decrypt A's envelope (wrong S), so the handshake fails. Both are
    // driven concurrently; Promise.all rejects as soon as B throws. (A is left
    // awaiting an answer that never comes — a real handshake would time out;
    // here we only assert the mismatch is caught.)
    const attempt = Promise.all([
      connect({
        role: 'A',
        roomId: 'room-1',
        pairingSecret: S,
        signaling: sigA,
        connector: connA,
        sink: new MemorySink(),
      }),
      connect({
        role: 'B',
        roomId: 'room-1',
        pairingSecret: wrong,
        signaling: sigB,
        connector: connB,
        sink: new MemorySink(),
      }),
    ])
    await expect(attempt).rejects.toThrow()
  })
})
