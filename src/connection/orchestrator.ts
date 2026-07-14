import { fromBase64, toBase64, utf8, zeroize } from '../crypto/bytes'
import {
  decryptEnvelope,
  deriveEnvelopeKey,
  encryptEnvelope,
} from '../crypto/envelope'
import { computeSharedSecret, generateKeyPair } from '../crypto/keypair'
import type { Sas } from '../crypto/sas'
import { deriveSession, type Session } from '../crypto/session'
import { finishSpake2, startSpake2 } from '../crypto/spake2'
import { TransportLink, type TransportLinkEvents } from '../transport/link'
import type { ChunkSink } from '../transport/receiver'
import { decodeHandshake, encodeHandshake } from './handshake'
import type { PeerConnector, SignalingChannel } from './types'

/**
 * Ordered queue over the signaling relay: the peer may send several messages in
 * sequence (in short-code mode, the SPAKE2 message *then* the encrypted
 * envelope). `next()` yields them in arrival order, buffering any that arrive
 * before they're awaited.
 */
function relayQueue(signaling: SignalingChannel): { next(): Promise<string> } {
  const buffered: string[] = []
  const waiters: ((payload: string) => void)[] = []
  signaling.onRelay = (payload) => {
    const waiter = waiters.shift()
    if (waiter) waiter(payload)
    else buffered.push(payload)
  }
  return {
    next(): Promise<string> {
      const ready = buffered.shift()
      if (ready !== undefined) return Promise.resolve(ready)
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

/**
 * Connection orchestrator (CLAUDE.md §3). Ties the pieces together into one
 * handshake, ending with a ready `TransportLink`:
 *
 *   1. derive the envelope key from S (server never sees it)
 *   2. A creates the room / B joins; A waits for B
 *   3. non-trickle ICE: A offers, B answers; each side wraps its SDP + X25519
 *      pubkey in an encrypted envelope and relays it (opaque to the server)
 *   4. K_dh = X25519(mine, theirs) → `deriveSession` → keys + SAS
 *   5. DataChannel opens → wrap in a `TransportLink`, route incoming frames
 *
 * The pairing secret S authenticates the whole exchange, so a hostile server
 * cannot MITM undetected; the SAS lets humans confirm it (§4.2).
 */

export type ConnectRole = 'A' | 'B'

export interface ConnectOptions {
  role: ConnectRole
  roomId: string
  /**
   * Pairing secret S from the link hash fragment (Link/QR mode). Provide this
   * OR `pakeCode` (short-code mode) — exactly one.
   */
  pairingSecret?: Uint8Array
  /**
   * Short-code (SPAKE2) mode: the shared human code. S is derived from it via a
   * PAKE round before the envelope exchange, so no guessable value hits the wire
   * (§4.3). Provide this OR `pairingSecret`.
   */
  pakeCode?: string
  signaling: SignalingChannel
  connector: PeerConnector
  /** Where this peer's incoming file bytes are written. */
  sink: ChunkSink
  chunkSize?: number
  events?: TransportLinkEvents
  /** Called if an incoming frame fails to decrypt/validate (fail closed). */
  onReceiveError?: (error: unknown) => void
}

export interface Connection {
  session: Session
  sas: Sas
  link: TransportLink
  close(): void
}

/**
 * S from the short code (SPAKE2, one relayed round) or the link fragment.
 * `ephemeral` marks a connect-owned secret (the SPAKE2 output) that connect must
 * zeroize after use — vs the caller-provided `pairingSecret`, which we must NOT
 * mutate (the caller owns its lifetime, and the tests share one buffer).
 */
async function derivePairingSecret(
  options: ConnectOptions,
  role: ConnectRole,
  relay: { next(): Promise<string> },
  signaling: SignalingChannel,
): Promise<{ secret: Uint8Array; ephemeral: boolean }> {
  if (options.pakeCode !== undefined) {
    const { state, message } = startSpake2(role, options.pakeCode)
    signaling.sendRelay(toBase64(message)) // public PAKE commitment, sent first
    const secret = finishSpake2(state, fromBase64(await relay.next()))
    return { secret, ephemeral: true }
  }
  if (options.pairingSecret) {
    return { secret: options.pairingSecret, ephemeral: false }
  }
  throw new Error('connect: provide either pairingSecret or pakeCode')
}

export async function connect(options: ConnectOptions): Promise<Connection> {
  const { role, roomId, signaling, connector } = options
  const relay = relayQueue(signaling) // installs signaling.onRelay

  // 1. Establish the room (A creates + waits for B; B joins).
  if (role === 'A') {
    let deliverJoined: () => void = () => {}
    const peerJoined = new Promise<void>((resolve) => {
      deliverJoined = resolve
    })
    signaling.onPeerJoined = () => deliverJoined()
    await signaling.create(roomId)
    await peerJoined
  } else {
    await signaling.join(roomId)
  }

  // 2. Derive the pairing secret S — from the code via SPAKE2 (short-code mode),
  //    or straight from the link fragment (Link/QR mode). The SPAKE2 message is
  //    public, so it's relayed in the clear; a wrong code yields a different S
  //    and fails closed at the envelope below (§4.3).
  const { secret: pairingSecret, ephemeral } = await derivePairingSecret(
    options,
    role,
    relay,
    signaling,
  )
  const envelopeKey = await deriveEnvelopeKey(pairingSecret, roomId)
  const myKeys = generateKeyPair()

  // 3. Encrypted envelope exchange (non-trickle ICE: exactly one each way).
  let peerPublicKey: Uint8Array
  if (role === 'A') {
    const offer = await connector.offer()
    const mine = encodeHandshake({
      description: offer,
      publicKey: myKeys.publicKey,
    })
    signaling.sendRelay(
      toBase64(await encryptEnvelope(envelopeKey, 'A', roomId, mine)),
    )

    const theirs = decodeHandshake(
      await decryptEnvelope(
        envelopeKey,
        'A',
        roomId,
        fromBase64(await relay.next()),
      ),
    )
    if (theirs.description.type !== 'answer') {
      throw new Error('connect: expected an answer from the peer')
    }
    await connector.accept(theirs.description)
    peerPublicKey = theirs.publicKey
  } else {
    const theirs = decodeHandshake(
      await decryptEnvelope(
        envelopeKey,
        'B',
        roomId,
        fromBase64(await relay.next()),
      ),
    )
    if (theirs.description.type !== 'offer') {
      throw new Error('connect: expected an offer from the peer')
    }
    const answer = await connector.answer(theirs.description)
    const mine = encodeHandshake({
      description: answer,
      publicKey: myKeys.publicKey,
    })
    signaling.sendRelay(
      toBase64(await encryptEnvelope(envelopeKey, 'B', roomId, mine)),
    )
    peerPublicKey = theirs.publicKey
  }

  const sharedSecret = computeSharedSecret(myKeys.secretKey, peerPublicKey)
  const session = await deriveSession({
    pairingSecret,
    sharedSecret,
    roomId,
    role,
  })
  // Short-code S lives only here (never surfaces to the controller), so wipe it
  // now that the session keys are derived (§4.6). A caller-provided pairingSecret
  // is left untouched — its owner (the controller, or a test) manages it.
  if (ephemeral) zeroize(pairingSecret)

  const channel = await connector.channel()
  const link = new TransportLink({
    channel,
    session,
    transferId: utf8(roomId),
    sink: options.sink,
    chunkSize: options.chunkSize,
    events: options.events,
  })
  channel.onMessage((frame) => {
    link.handleIncoming(frame).catch((error) => options.onReceiveError?.(error))
  })

  return {
    session,
    sas: session.sas,
    link,
    close: () => connector.close(),
  }
}
