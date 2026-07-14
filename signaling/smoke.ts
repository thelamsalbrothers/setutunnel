/**
 * Headless end-to-end smoke test for the signaling server (no browser needed).
 * Starts the server in-process on a random port and drives two real WebSocket
 * clients through create → join → relay (both ways) → room-full → peer-left,
 * asserting the observable protocol. Run: `bun signaling/smoke.ts`.
 */
import { startSignalingServer } from './server'

const server = startSignalingServer(0)
const url = `ws://localhost:${server.port}`

type Json = Record<string, unknown>

function client() {
  const ws = new WebSocket(url)
  const queue: Json[] = []
  const waiters: Array<(v: Json) => void> = []
  ws.addEventListener('message', (event) => {
    const text =
      typeof event.data === 'string' ? event.data : String(event.data)
    const msg = JSON.parse(text) as Json
    const waiter = waiters.shift()
    if (waiter) waiter(msg)
    else queue.push(msg)
  })
  const opened = new Promise<void>((resolve) =>
    ws.addEventListener('open', () => resolve()),
  )
  return {
    opened,
    next(): Promise<Json> {
      const queued = queue.shift()
      if (queued) return Promise.resolve(queued)
      return new Promise((resolve) => waiters.push(resolve))
    },
    send(obj: unknown) {
      ws.send(JSON.stringify(obj))
    },
    close() {
      ws.close()
    },
  }
}

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`SMOKE FAIL: ${message}`)
    server.stop(true)
    process.exit(1)
  }
}

const a = client()
await a.opened
a.send({ type: 'create', roomId: 'room-1' })
assert((await a.next()).type === 'created', 'A receives created')

const b = client()
await b.opened
b.send({ type: 'join', roomId: 'room-1' })
assert((await b.next()).type === 'joined', 'B receives joined')
assert((await a.next()).type === 'peer-joined', 'A receives peer-joined')

a.send({ type: 'relay', payload: 'envelope-from-A' })
const toB = await b.next()
assert(
  toB.type === 'relay' && toB.payload === 'envelope-from-A',
  'B receives A envelope verbatim',
)

b.send({ type: 'relay', payload: 'envelope-from-B' })
const toA = await a.next()
assert(
  toA.type === 'relay' && toA.payload === 'envelope-from-B',
  'A receives B envelope verbatim',
)

const c = client()
await c.opened
c.send({ type: 'join', roomId: 'room-1' })
assert((await c.next()).type === 'error', 'third peer is rejected (1-to-1)')
c.close()

b.close()
assert((await a.next()).type === 'peer-left', 'A is told the peer left')

console.log('SMOKE OK — signaling create/join/relay/room-full/peer-left')
server.stop(true)
process.exit(0)
