/**
 * Self-hostable signaling server (CLAUDE.md §5) on Bun's native WebSockets — no
 * `ws` dependency. It runs the shared `RoomManager` from `src/signaling/`, so it
 * speaks the exact same wire protocol as the browser client and the primary
 * Cloudflare Worker will. Zero-knowledge by construction: it only routes control
 * and relays opaque encrypted envelopes; it never sees plaintext, key, or file.
 *
 * Run: `bun signaling/server.ts` (PORT env, default 8787). This file is a Bun
 * runtime entry — it is intentionally outside `src/` (the browser build) and is
 * verified by `signaling/smoke.ts` rather than the Vite/tsc pipeline.
 */
import {
  parseClientMessage,
  type ServerMessage,
} from '../src/signaling/protocol'
import { RoomManager, type SignalingPeer } from '../src/signaling/rooms'
import { buildTurnPayload } from '../src/signaling/turn'

/**
 * CORS for the `/turn` GET: the app is usually on a different origin than the
 * signaling host. Echo an allowed origin (or `*` when no allowlist is set).
 */
function corsOrigin(origin: string | null, allowed?: string): string {
  if (!allowed) return '*'
  if (origin && allowed.split(',').some((entry) => entry.trim() === origin)) {
    return origin
  }
  return 'null'
}

interface WsData {
  peer: SignalingPeer
}

export function startSignalingServer(port = 8787) {
  const manager = new RoomManager()
  let nextId = 1

  const server = Bun.serve<WsData>({
    port,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        return new Response('ok', { headers: { 'content-type': 'text/plain' } })
      }
      // Ephemeral TURN credentials (§5) — enabled only when TURN_URLS +
      // TURN_SECRET are set. The secret stays server-side; the client gets a
      // short-lived credential. See src/signaling/turn.ts.
      if (url.pathname === '/turn') {
        const cors = {
          'access-control-allow-origin': corsOrigin(
            req.headers.get('origin'),
            process.env.ALLOWED_ORIGINS,
          ),
        }
        const payload = await buildTurnPayload(
          {
            urls: process.env.TURN_URLS,
            secret: process.env.TURN_SECRET,
            ttlSeconds: process.env.TURN_TTL
              ? Number(process.env.TURN_TTL)
              : undefined,
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
      const peer: SignalingPeer = {
        id: `p${nextId++}`,
        send: () => {}, // bound to this socket in `open`
      }
      if (srv.upgrade(req, { data: { peer } })) return undefined
      return new Response('setutunnel signaling — websocket upgrade required', {
        status: 426,
      })
    },
    websocket: {
      open(ws) {
        ws.data.peer.send = (message: ServerMessage) => {
          ws.send(JSON.stringify(message))
        }
      },
      message(ws, raw) {
        const text = typeof raw === 'string' ? raw : raw.toString()
        const parsed = parseClientMessage(text)
        if (!parsed) {
          ws.data.peer.send({
            type: 'error',
            code: 'bad-message',
            message: 'invalid signaling message',
          })
          return
        }
        manager.handle(ws.data.peer, parsed)
      },
      close(ws) {
        manager.disconnect(ws.data.peer.id)
      },
    },
  })

  setInterval(() => manager.gc(), 60_000)
  return server
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787)
  const server = startSignalingServer(port)
  console.log(`setutunnel signaling listening on :${server.port}`)
}
