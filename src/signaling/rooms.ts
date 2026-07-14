import type { ClientMessage, ServerMessage } from './protocol'

/**
 * In-memory room manager (CLAUDE.md §3, §11). Strictly 1-to-1: a room holds at
 * most two peers (creator A + joiner B). The manager only routes control and
 * relays opaque envelopes — it never inspects or stores payload contents, and
 * rooms are transient, GC'd on disconnect or TTL expiry. Pure and IO-free
 * (peers are an abstract `send`), so it unit-tests without a real socket.
 */

export interface SignalingPeer {
  readonly id: string
  send(message: ServerMessage): void
}

interface Room {
  id: string
  createdAt: number
  a: SignalingPeer | null
  b: SignalingPeer | null
}

export interface RoomManagerOptions {
  /** Clock injection for deterministic TTL tests. Defaults to `Date.now`. */
  now?: () => number
  /** Unclaimed-room TTL before GC. Default 10 minutes (§3). */
  ttlMs?: number
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly peerRoom = new Map<string, string>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
  }

  handle(peer: SignalingPeer, message: ClientMessage): void {
    switch (message.type) {
      case 'create':
        return this.onCreate(peer, message.roomId)
      case 'join':
        return this.onJoin(peer, message.roomId)
      case 'relay':
        return this.onRelay(peer, message.payload)
      case 'leave':
        return this.removePeer(peer.id, true)
    }
  }

  /** A socket closed: tear down its room and notify the other peer. */
  disconnect(peerId: string): void {
    this.removePeer(peerId, true)
  }

  /** Remove unclaimed rooms past their TTL. Call periodically. */
  gc(): void {
    const cutoff = this.now() - this.ttlMs
    for (const [id, room] of this.rooms) {
      if (room.b === null && room.createdAt <= cutoff) {
        if (room.a) {
          room.a.send({
            type: 'error',
            code: 'room-not-found',
            message: 'room expired',
          })
          this.peerRoom.delete(room.a.id)
        }
        this.rooms.delete(id)
      }
    }
  }

  roomCount(): number {
    return this.rooms.size
  }

  private onCreate(peer: SignalingPeer, roomId: string): void {
    if (this.rooms.has(roomId)) {
      peer.send({
        type: 'error',
        code: 'room-exists',
        message: 'room already exists',
      })
      return
    }
    this.rooms.set(roomId, {
      id: roomId,
      createdAt: this.now(),
      a: peer,
      b: null,
    })
    this.peerRoom.set(peer.id, roomId)
    peer.send({ type: 'created', roomId })
  }

  private onJoin(peer: SignalingPeer, roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room || room.a === null) {
      peer.send({
        type: 'error',
        code: 'room-not-found',
        message: 'no such room',
      })
      return
    }
    if (room.b !== null) {
      peer.send({
        type: 'error',
        code: 'room-full',
        message: 'room already has two peers',
      })
      return
    }
    room.b = peer
    this.peerRoom.set(peer.id, roomId)
    peer.send({ type: 'joined', roomId })
    room.a.send({ type: 'peer-joined' })
  }

  private onRelay(peer: SignalingPeer, payload: string): void {
    const other = this.otherPeer(peer.id)
    if (!other) {
      peer.send({
        type: 'error',
        code: 'not-in-room',
        message: 'no peer to relay to',
      })
      return
    }
    other.send({ type: 'relay', payload })
  }

  private otherPeer(peerId: string): SignalingPeer | null {
    const roomId = this.peerRoom.get(peerId)
    if (!roomId) return null
    const room = this.rooms.get(roomId)
    if (!room) return null
    if (room.a?.id === peerId) return room.b
    if (room.b?.id === peerId) return room.a
    return null
  }

  private removePeer(peerId: string, notify: boolean): void {
    const roomId = this.peerRoom.get(peerId)
    this.peerRoom.delete(peerId)
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (!room) return

    let other: SignalingPeer | null = null
    if (room.a?.id === peerId) {
      other = room.b
      room.a = null
    } else if (room.b?.id === peerId) {
      other = room.a
      room.b = null
    }

    // 1-to-1: once either side leaves, the tunnel is over. Notify the other
    // peer and drop the whole room (§11 — no reconnecting a third party in).
    if (other) {
      if (notify) other.send({ type: 'peer-left' })
      this.peerRoom.delete(other.id)
    }
    this.rooms.delete(roomId)
  }
}
