/**
 * Headless end-to-end test of the browser `SignalingClient` against the real
 * Bun server (no browser needed — Bun provides a web-standard `WebSocket`).
 * Drives two clients through create → join → peer-joined → relay (both ways) →
 * join-nonexistent (reject) → peer-left. Run: `bun signaling/client-smoke.ts`.
 */
import { SignalingClient } from '../src/signaling/client'
import { startSignalingServer } from './server'

const server = startSignalingServer(0)
const url = `ws://localhost:${server.port}`

function fail(message: string): never {
  console.error(`CLIENT SMOKE FAIL: ${message}`)
  server.stop(true)
  process.exit(1)
}
function assert(cond: boolean, message: string) {
  if (!cond) fail(message)
}
const tick = () => new Promise((r) => setTimeout(r, 50))

let aPeerJoined = false
let aPeerLeft = false
const gotByA: string[] = []
const gotByB: string[] = []

const a = new SignalingClient(url, {
  onPeerJoined: () => {
    aPeerJoined = true
  },
  onRelay: (p) => gotByA.push(p),
  onPeerLeft: () => {
    aPeerLeft = true
  },
})
const b = new SignalingClient(url, { onRelay: (p) => gotByB.push(p) })

await a.connect()
await a.create('room-x')

await b.connect()
await b.join('room-x')
await tick()
assert(aPeerJoined, 'A should be told the peer joined')

a.sendRelay('hello-from-A')
b.sendRelay('hello-from-B')
await tick()
assert(gotByB.includes('hello-from-A'), 'B should receive A envelope verbatim')
assert(gotByA.includes('hello-from-B'), 'A should receive B envelope verbatim')

// Joining a room that does not exist must reject the promise.
const c = new SignalingClient(url)
await c.connect()
let rejected = false
try {
  await c.join('nope')
} catch {
  rejected = true
}
assert(rejected, 'joining a nonexistent room should reject')
c.close()

b.close()
await tick()
assert(aPeerLeft, 'A should be told the peer left when B closes')

console.log('CLIENT SMOKE OK — connect/create/join/relay/reject/peer-left')
server.stop(true)
process.exit(0)
