import type { ClientMessage, ServerMessage } from './protocol'

/**
 * Browser signaling client (CLAUDE.md §3): a thin typed wrapper over the
 * `WebSocket` speaking the wire protocol. `create`/`join` resolve on the
 * server's ack (or reject on an error); server-pushed events (`peer-joined`,
 * `relay`, `peer-left`) surface through callbacks. It relays only opaque
 * envelope strings — the caller is responsible for encrypting them with the
 * envelope key (see `crypto/envelope.ts`) so the server stays zero-knowledge.
 */

export interface SignalingHandlers {
  onPeerJoined?: () => void
  onRelay?: (payload: string) => void
  onPeerLeft?: () => void
  onError?: (code: string, message: string) => void
  onClose?: () => void
}

type Pending = {
  expect: 'created' | 'joined'
  resolve: () => void
  reject: (error: Error) => void
}

export class SignalingClient implements SignalingHandlers {
  // Public + mutable so a caller (e.g. the connection orchestrator) can wire
  // handlers after construction; this also makes the client satisfy the
  // orchestrator's structural `SignalingChannel` type.
  onPeerJoined?: () => void
  onRelay?: (payload: string) => void
  onPeerLeft?: () => void
  onError?: (code: string, message: string) => void
  onClose?: () => void

  private readonly url: string
  private ws: WebSocket | null = null
  private pending: Pending | null = null

  constructor(url: string, handlers: SignalingHandlers = {}) {
    this.url = url
    this.onPeerJoined = handlers.onPeerJoined
    this.onRelay = handlers.onRelay
    this.onPeerLeft = handlers.onPeerLeft
    this.onError = handlers.onError
    this.onClose = handlers.onClose
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () =>
        reject(new Error('signaling: connection failed')),
      )
      ws.addEventListener('close', () => this.onClose?.())
      ws.addEventListener('message', (event) => {
        this.onMessage(event.data)
      })
    })
  }

  /** Create/claim a room as the offerer (peer A). Resolves on `created`. */
  create(roomId: string): Promise<void> {
    return this.request({ type: 'create', roomId }, 'created')
  }

  /** Join an existing room as the answerer (peer B). Resolves on `joined`. */
  join(roomId: string): Promise<void> {
    return this.request({ type: 'join', roomId }, 'joined')
  }

  /** Relay one opaque (already-encrypted) envelope to the other peer. */
  sendRelay(payload: string): void {
    this.send({ type: 'relay', payload })
  }

  leave(): void {
    this.send({ type: 'leave' })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }

  private request(
    message: ClientMessage,
    expect: 'created' | 'joined',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('signaling: not connected'))
        return
      }
      this.pending = { expect, resolve, reject }
      this.send(message)
    })
  }

  private send(message: ClientMessage): void {
    this.ws?.send(JSON.stringify(message))
  }

  private onMessage(data: unknown): void {
    let message: ServerMessage
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      return
    }

    switch (message.type) {
      case 'created':
      case 'joined':
        if (this.pending?.expect === message.type) {
          this.pending.resolve()
          this.pending = null
        }
        return
      case 'error':
        if (this.pending) {
          this.pending.reject(
            new Error(`signaling ${message.code}: ${message.message}`),
          )
          this.pending = null
        } else {
          this.onError?.(message.code, message.message)
        }
        return
      case 'peer-joined':
        this.onPeerJoined?.()
        return
      case 'relay':
        this.onRelay?.(message.payload)
        return
      case 'peer-left':
        this.onPeerLeft?.()
        return
    }
  }
}
