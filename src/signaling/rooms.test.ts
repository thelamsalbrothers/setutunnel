import { describe, expect, it } from 'vitest'
import type { ServerMessage } from './protocol'
import { RoomManager, type SignalingPeer } from './rooms'

class FakePeer implements SignalingPeer {
  readonly id: string
  readonly sent: ServerMessage[] = []
  constructor(id: string) {
    this.id = id
  }
  send(message: ServerMessage): void {
    this.sent.push(message)
  }
  last(): ServerMessage | undefined {
    return this.sent.at(-1)
  }
}

describe('RoomManager', () => {
  it('creates a room and rejects a duplicate', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    m.handle(a, { type: 'create', roomId: 'r1' })
    expect(a.last()).toEqual({ type: 'created', roomId: 'r1' })

    const a2 = new FakePeer('a2')
    m.handle(a2, { type: 'create', roomId: 'r1' })
    expect(a2.last()).toMatchObject({ type: 'error', code: 'room-exists' })
  })

  it('rejects joining a non-existent room', () => {
    const m = new RoomManager()
    const b = new FakePeer('b')
    m.handle(b, { type: 'join', roomId: 'nope' })
    expect(b.last()).toMatchObject({ type: 'error', code: 'room-not-found' })
  })

  it('pairs A and B and notifies the waiting creator', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    const b = new FakePeer('b')
    m.handle(a, { type: 'create', roomId: 'r1' })
    m.handle(b, { type: 'join', roomId: 'r1' })
    expect(b.last()).toEqual({ type: 'joined', roomId: 'r1' })
    expect(a.last()).toEqual({ type: 'peer-joined' })
  })

  it('rejects a third peer (strictly 1-to-1)', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    const b = new FakePeer('b')
    const c = new FakePeer('c')
    m.handle(a, { type: 'create', roomId: 'r1' })
    m.handle(b, { type: 'join', roomId: 'r1' })
    m.handle(c, { type: 'join', roomId: 'r1' })
    expect(c.last()).toMatchObject({ type: 'error', code: 'room-full' })
  })

  it('relays opaque envelopes both ways', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    const b = new FakePeer('b')
    m.handle(a, { type: 'create', roomId: 'r1' })
    m.handle(b, { type: 'join', roomId: 'r1' })

    m.handle(a, { type: 'relay', payload: 'from-A' })
    expect(b.last()).toEqual({ type: 'relay', payload: 'from-A' })
    m.handle(b, { type: 'relay', payload: 'from-B' })
    expect(a.last()).toEqual({ type: 'relay', payload: 'from-B' })
  })

  it('errors when relaying with no peer present', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    m.handle(a, { type: 'create', roomId: 'r1' })
    m.handle(a, { type: 'relay', payload: 'x' })
    expect(a.last()).toMatchObject({ type: 'error', code: 'not-in-room' })
  })

  it('tears down the room and notifies the peer on disconnect', () => {
    const m = new RoomManager()
    const a = new FakePeer('a')
    const b = new FakePeer('b')
    m.handle(a, { type: 'create', roomId: 'r1' })
    m.handle(b, { type: 'join', roomId: 'r1' })

    m.disconnect(a.id)
    expect(b.last()).toEqual({ type: 'peer-left' })
    expect(m.roomCount()).toBe(0)

    // The surviving peer can no longer relay into the dropped room.
    m.handle(b, { type: 'relay', payload: 'x' })
    expect(b.last()).toMatchObject({ type: 'error', code: 'not-in-room' })
  })

  it('GCs unclaimed rooms past the TTL, but keeps claimed ones', () => {
    let clock = 0
    const m = new RoomManager({ now: () => clock, ttlMs: 1000 })

    const a = new FakePeer('a')
    m.handle(a, { type: 'create', roomId: 'stale' })

    const c = new FakePeer('c')
    const d = new FakePeer('d')
    m.handle(c, { type: 'create', roomId: 'live' })
    m.handle(d, { type: 'join', roomId: 'live' })

    clock = 2000
    m.gc()

    expect(m.roomCount()).toBe(1) // 'live' survives, 'stale' collected
    expect(a.last()).toMatchObject({ type: 'error', code: 'room-not-found' })
  })
})
