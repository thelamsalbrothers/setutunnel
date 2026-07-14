import type { ConnectRole } from '../connection/orchestrator'
import type {
  DuplexChannel,
  PeerConnector,
  SessionDescription,
} from '../connection/types'
import { asBufferSource } from '../crypto/bytes'

/**
 * WebRTC binding (CLAUDE.md §5, §6D): implements the `PeerConnector` /
 * `DuplexChannel` abstractions over a real `RTCPeerConnection` / `RTCDataChannel`.
 * This is the only browser-only piece of the transport — everything above it is
 * unit-tested against fakes; this is verified by the Playwright E2E.
 *
 * Non-trickle ICE: `offer`/`answer` wait for ICE gathering to complete so the
 * returned SDP already carries every candidate, which keeps the signaling
 * exchange to a single encrypted envelope each way (see the orchestrator).
 */

const DATA_CHANNEL_LABEL = 'setu'

/** Public STUN by default; override for self-hosted STUN/TURN (short-lived creds). */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

export interface WebRtcConnectorOptions {
  iceServers?: RTCIceServer[]
  /** Called once if the peer connection fails (peer gone / network dropped), so
   *  a stuck transfer can be surfaced instead of hanging on backpressure. */
  onDisconnect?: () => void
}

function wrapChannel(dc: RTCDataChannel): DuplexChannel {
  dc.binaryType = 'arraybuffer'

  // Buffer any frames that arrive before a handler is attached, then flush.
  // (In practice the peer only sends after both handshakes finish, but a real
  // channel could deliver early — never drop a frame.)
  let handler: ((frame: Uint8Array) => void) | null = null
  const pending: Uint8Array[] = []
  dc.addEventListener('message', (event) => {
    const frame = toBytes(event.data)
    if (!frame) return
    if (handler) handler(frame)
    else pending.push(frame)
  })

  return {
    get readyState() {
      return dc.readyState
    },
    get bufferedAmount() {
      return dc.bufferedAmount
    },
    get bufferedAmountLowThreshold() {
      return dc.bufferedAmountLowThreshold
    },
    set bufferedAmountLowThreshold(value: number) {
      dc.bufferedAmountLowThreshold = value
    },
    send(data: Uint8Array) {
      dc.send(asBufferSource(data))
    },
    addEventListener(type, listener) {
      dc.addEventListener(type, listener)
    },
    removeEventListener(type, listener) {
      dc.removeEventListener(type, listener)
    },
    onMessage(next: (frame: Uint8Array) => void) {
      handler = next
      for (const frame of pending.splice(0)) next(frame)
    },
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return null // strings are not part of our wire protocol
}

function waitForOpen(dc: RTCDataChannel): Promise<DuplexChannel> {
  const channel = wrapChannel(dc)
  if (dc.readyState === 'open') return Promise.resolve(channel)
  return new Promise((resolve, reject) => {
    dc.addEventListener('open', () => resolve(channel))
    dc.addEventListener('error', () =>
      reject(new Error('webrtc: data channel error')),
    )
  })
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}

function localSdp(pc: RTCPeerConnection): string {
  const sdp = pc.localDescription?.sdp
  if (!sdp) throw new Error('webrtc: missing local description')
  return sdp
}

export function createWebRtcConnector(
  role: ConnectRole,
  options: WebRtcConnectorOptions = {},
): PeerConnector {
  const pc = new RTCPeerConnection({
    iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
  })

  const onDisconnect = options.onDisconnect
  if (onDisconnect) {
    let notified = false
    pc.addEventListener('connectionstatechange', () => {
      // 'failed' is terminal (ICE gave up); 'disconnected' can recover, so we
      // don't fire on it. Notify at most once.
      if (pc.connectionState === 'failed' && !notified) {
        notified = true
        onDisconnect()
      }
    })
  }

  const channel: Promise<DuplexChannel> =
    role === 'A'
      ? waitForOpen(pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }))
      : new Promise((resolve) => {
          pc.addEventListener('datachannel', (event) => {
            resolve(waitForOpen(event.channel))
          })
        })

  return {
    async offer() {
      await pc.setLocalDescription(await pc.createOffer())
      await waitForIceGathering(pc)
      return { type: 'offer', sdp: localSdp(pc) }
    },
    async answer(remote: SessionDescription) {
      await pc.setRemoteDescription({ type: 'offer', sdp: remote.sdp })
      await pc.setLocalDescription(await pc.createAnswer())
      await waitForIceGathering(pc)
      return { type: 'answer', sdp: localSdp(pc) }
    },
    async accept(remote: SessionDescription) {
      await pc.setRemoteDescription({ type: 'answer', sdp: remote.sdp })
    },
    channel() {
      return channel
    },
    close() {
      pc.close()
    },
  }
}
