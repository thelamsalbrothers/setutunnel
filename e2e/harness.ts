import { connect } from '../src/connection/orchestrator'
import { concatBytes, fromHex, toHex, utf8 } from '../src/crypto/bytes'
import { sha256Once } from '../src/crypto/hash'
import { generatePairing } from '../src/protocol/pairing'
import { SignalingClient } from '../src/signaling/client'
import { MemorySource } from '../src/transport/memory'
import type { ChunkSink } from '../src/transport/receiver'
import { createWebRtcConnector } from '../src/transport/webrtc'

/**
 * Browser test harness for the Playwright E2E. Exposes a tiny API on `window`
 * that drives the *real* stack — SignalingClient + WebRTC binding + connect()
 * orchestrator — so the E2E can run an actual encrypted DataChannel transfer
 * between two pages. Not part of the app; loaded only at `/e2e/harness.html`.
 */

const SIGNALING_URL = 'ws://localhost:8787'
// Localhost: gather host candidates only — no external STUN needed or wanted.
const ICE_SERVERS: RTCIceServer[] = []

// The `window.__setu` / `window.__recvHash` types live in `env.d.ts` so both
// this harness and the spec (`transfer.spec.ts`) share them.
window.__setu = {
  async createRoom() {
    const pairing = generatePairing()
    const client = new SignalingClient(SIGNALING_URL)
    await client.connect()

    const parts: Uint8Array[] = []
    let resolveHash: (hex: string) => void = () => {}
    window.__recvHash = new Promise((resolve) => {
      resolveHash = resolve
    })
    let resolveSas: (sas: string) => void = () => {}
    window.__sas = new Promise((resolve) => {
      resolveSas = resolve
    })

    const sink: ChunkSink = {
      async write(chunk) {
        parts.push(chunk.slice())
      },
      async close() {},
    }

    // Role A (offerer/receiver). Runs in the background: it can't finish until
    // the sender joins, so createRoom returns the pairing info right away.
    connect({
      role: 'A',
      roomId: pairing.roomId,
      pairingSecret: pairing.secret,
      signaling: client,
      connector: createWebRtcConnector('A', { iceServers: ICE_SERVERS }),
      sink,
      events: {
        onReceive: (event) => {
          if (event.kind === 'data' && event.isFinal) {
            void sha256Once(concatBytes(...parts)).then((digest) =>
              resolveHash(toHex(digest)),
            )
          }
        },
      },
      onReceiveError: (error) => {
        window.__error = `receive: ${String(error)}`
      },
    })
      .then((connection) => resolveSas(connection.sas.number))
      .catch((error) => {
        window.__error = `connect A: ${String(error)}`
      })

    return { roomId: pairing.roomId, secretHex: toHex(pairing.secret) }
  },

  async joinAndSend(roomId, secretHex, text) {
    const client = new SignalingClient(SIGNALING_URL)
    await client.connect()
    const sink: ChunkSink = { async write() {}, async close() {} }
    const connection = await connect({
      role: 'B',
      roomId,
      pairingSecret: fromHex(secretHex),
      signaling: client,
      connector: createWebRtcConnector('B', { iceServers: ICE_SERVERS }),
      sink,
    })
    const data = utf8(text)
    await connection.link.sendFile(new MemorySource(data))
    return {
      sas: connection.sas.number,
      sentHash: toHex(await sha256Once(data)),
    }
  },
}

const status = document.getElementById('status')
if (status) status.textContent = 'ready'

export {}
