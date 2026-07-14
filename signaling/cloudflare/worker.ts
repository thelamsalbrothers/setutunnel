/**
 * Primary signaling on Cloudflare Workers + Durable Objects (CLAUDE.md §5).
 *
 * A single coordinator Durable Object runs the *exact* shared `RoomManager` from
 * `src/signaling/rooms.ts`, so this speaks the identical wire protocol as the
 * browser `SignalingClient` and the self-host Bun server — a drop-in primary,
 * already covered by the pure-core unit + smoke tests. The wire protocol carries
 * the roomId inside the `create`/`join` message (not the URL), which is exactly
 * why one coordinator DO is the natural fit here; sharding into one-DO-per-room
 * (the §5 ideal for massive scale) is a future step that needs roomId-in-URL
 * routing. For a 1-to-1 tool a single DO's throughput is ample.
 *
 * Zero-knowledge by construction (§1, §4.5): the DO only routes control and
 * relays opaque, client-encrypted envelopes. It never sees plaintext, the
 * pairing secret S, a CryptoKey, or a file byte. Durable storage is used *only*
 * to schedule a GC alarm — never for payloads.
 *
 * Free-tier note: the migration uses `new_sqlite_classes`, i.e. a SQLite-backed
 * Durable Object, which is the flavor available on the Workers **free plan**.
 * It scales to zero and costs ~nothing at idle.
 *
 * Deploy: `bun run signaling:cf:deploy`. Local dev: `bun run signaling:cf:dev`.
 */
import {
  parseClientMessage,
  type ServerMessage,
} from '../../src/signaling/protocol'
import { RoomManager, type SignalingPeer } from '../../src/signaling/rooms'
import { buildTurnPayload } from '../../src/signaling/turn'

export interface Env {
  ROOMS: DurableObjectNamespace
  /** Optional comma-separated Origin allowlist; unset ⇒ any origin allowed. */
  ALLOWED_ORIGINS?: string
  /** Comma-separated TURN URLs; enables `/turn` when set with TURN_SECRET. */
  TURN_URLS?: string
  /** coturn shared secret (a Wrangler *secret*, never in wrangler.toml). */
  TURN_SECRET?: string
  /** TURN credential TTL in seconds (default 24h). */
  TURN_TTL?: string
}

/** How often the backstop GC alarm runs while the DO has live sockets. */
const GC_INTERVAL_MS = 60_000

/**
 * The whole coordinator: one DO instance holds every live room in memory via the
 * shared `RoomManager`. Because a room requires at least one *connected* peer,
 * the DO only ever holds evictable state while sockets are open — and standard
 * (non-hibernation) WebSockets keep the DO resident for the socket's lifetime,
 * so the in-memory room map stays consistent for the whole (short-lived, §3)
 * signaling session. When the last socket closes there are no rooms left to
 * lose, so eviction is safe.
 */
export class SignalingRoom {
  private readonly manager = new RoomManager()
  private readonly peers = new Set<WebSocket>()
  private readonly state: DurableObjectState
  private nextId = 1

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    this.peers.add(server)

    const peer: SignalingPeer = {
      id: `p${this.nextId++}`,
      send: (message: ServerMessage) => {
        try {
          server.send(JSON.stringify(message))
        } catch {
          // socket already closing/closed — nothing to deliver
        }
      },
    }

    server.addEventListener('message', (event: MessageEvent) => {
      const text =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer)
      const parsed = parseClientMessage(text)
      if (!parsed) {
        peer.send({
          type: 'error',
          code: 'bad-message',
          message: 'invalid signaling message',
        })
        return
      }
      this.manager.handle(peer, parsed)
    })

    const drop = () => {
      this.manager.disconnect(peer.id)
      this.peers.delete(server)
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    await this.ensureGcScheduled()
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Backstop GC for rooms created but never joined (§3 TTL). */
  async alarm(): Promise<void> {
    this.manager.gc()
    if (this.peers.size > 0) {
      await this.state.storage.setAlarm(Date.now() + GC_INTERVAL_MS)
    }
  }

  private async ensureGcScheduled(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + GC_INTERVAL_MS)
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    }

    // Ephemeral TURN credentials (§5) — enabled only when TURN_URLS + the
    // TURN_SECRET Wrangler secret are set. See src/signaling/turn.ts.
    if (url.pathname === '/turn') {
      const cors = {
        'access-control-allow-origin': corsOrigin(
          request.headers.get('Origin'),
          env.ALLOWED_ORIGINS,
        ),
      }
      const payload = await buildTurnPayload(
        {
          urls: env.TURN_URLS,
          secret: env.TURN_SECRET,
          ttlSeconds: env.TURN_TTL ? Number(env.TURN_TTL) : undefined,
        },
        Date.now() / 1000,
      )
      if (!payload) {
        return new Response('turn not configured', {
          status: 404,
          headers: cors,
        })
      }
      return Response.json(payload, { headers: cors })
    }

    if ((request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket') {
      if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
        return new Response('origin not allowed', { status: 403 })
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName('global'))
      return stub.fetch(request)
    }

    return new Response('setutunnel signaling — websocket upgrade required', {
      status: 426,
    })
  },
}

/** No allowlist configured ⇒ open. Otherwise the Origin must match exactly. */
function originAllowed(origin: string | null, allowed?: string): boolean {
  if (!allowed) return true
  if (!origin) return false
  return allowed.split(',').some((entry) => entry.trim() === origin)
}

/** CORS origin for the `/turn` GET: echo an allowed origin, else `*`/`null`. */
function corsOrigin(origin: string | null, allowed?: string): string {
  if (!allowed) return '*'
  if (origin && allowed.split(',').some((entry) => entry.trim() === origin)) {
    return origin
  }
  return 'null'
}
