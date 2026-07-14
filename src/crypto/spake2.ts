import { mod } from '@noble/curves/abstract/modular'
import { bytesToNumberLE, numberToBytesLE } from '@noble/curves/abstract/utils'
import { ed25519, RistrettoPoint } from '@noble/curves/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2'
import { concatBytes, u64be, utf8 } from './bytes'

/**
 * SPAKE2 balanced PAKE for short-code pairing (CLAUDE.md §4.3). A short,
 * human-speakable code is turned into a strong shared secret S **without ever
 * putting a guessable value on the wire**: an active attacker who relays the
 * signaling gets at most ONE online password guess per run (SPAKE2's guarantee),
 * and any wrong guess yields a different S — so it fails to decrypt the
 * authenticated signaling envelope downstream (fail closed), and the out-of-band
 * SAS lets humans catch a MITM (§4.2).
 *
 * Group: ristretto255 — a prime-order group (no cofactor pitfalls), via the
 * audited @noble/curves. Because SetuTunnel is a closed system (both peers run
 * this code), the group elements M and N need not match any RFC's constants;
 * they are our own **nothing-up-my-sleeve** points, derived by hashing fixed
 * labels onto the group so nobody knows their discrete log w.r.t. the base point
 * (the property SPAKE2 requires). No hand-rolled primitives — only curve/hash
 * operations from @noble, composed per the SPAKE2 construction (§4.6).
 *
 * Protocol (role A uses mask M, role B uses mask N):
 *   w  = H(code) mod L                       # password scalar
 *   x  = random scalar                       # ephemeral secret
 *   pub= x·G + w·(role==A ? M : N)           # the message sent to the peer
 *   K  = x·(peerPub − w·(role==A ? N : M))   # == xy·G on both sides
 *   S  = SHA-256( transcript(M,N,pA,pB,K,w) ) # 32-byte shared pairing secret
 * S then feeds the SAME key schedule as Link/QR mode (deriveSession + SAS).
 */

const L = ed25519.CURVE.n
const G = RistrettoPoint.BASE

/** Hash a fixed label onto the ristretto255 group (nobody knows its dlog / G). */
function hashToPoint(label: string) {
  return RistrettoPoint.hashToCurve(sha512(utf8(label)))
}
const M = hashToPoint('setu/spake2/M/v1')
const N = hashToPoint('setu/spake2/N/v1')

/** Map bytes uniformly to a scalar in [0, L): 64-byte hash reduced mod L. */
function scalarFromHash(...parts: Uint8Array[]): bigint {
  return mod(bytesToNumberLE(sha512(concatBytes(...parts))), L)
}

function passwordScalar(code: string): bigint {
  return scalarFromHash(utf8('setu/spake2/pw/v1'), utf8(code))
}

/** Uniform nonzero scalar in [1, L): 64 random bytes reduced mod L (retry on 0). */
function randomScalar(): bigint {
  for (;;) {
    const s = mod(
      bytesToNumberLE(crypto.getRandomValues(new Uint8Array(64))),
      L,
    )
    if (s !== 0n) return s
  }
}

export type Spake2Role = 'A' | 'B'

export interface Spake2State {
  readonly role: Spake2Role
  readonly w: bigint
  readonly x: bigint
  readonly myMessage: Uint8Array
}

export interface Spake2Start {
  readonly state: Spake2State
  /** The 32-byte public message to relay to the peer. */
  readonly message: Uint8Array
}

/**
 * Begin SPAKE2: derive the password scalar, pick an ephemeral secret, and
 * produce the public message to send. `scalar` is injectable **only for
 * deterministic test vectors**; production always uses a fresh random scalar.
 */
export function startSpake2(
  role: Spake2Role,
  code: string,
  scalar: bigint = randomScalar(),
): Spake2Start {
  const w = passwordScalar(code)
  const mask = role === 'A' ? M : N
  const message = G.multiply(scalar).add(mask.multiply(w)).toRawBytes()
  return { state: { role, w, x: scalar, myMessage: message }, message }
}

/** Length-prefixed (8-byte big-endian) transcript element. */
function field(bytes: Uint8Array): Uint8Array {
  return concatBytes(u64be(BigInt(bytes.length)), bytes)
}

/**
 * Complete SPAKE2 with the peer's message and derive the 32-byte shared secret
 * S. Fails closed (throws) on a malformed/degenerate peer point — every incoming
 * byte is hostile (§4.7). Both peers compute the identical S iff they used the
 * same code.
 */
export function finishSpake2(
  state: Spake2State,
  peerMessage: Uint8Array,
): Uint8Array {
  // fromHex validates canonical ristretto encoding; reject the identity too.
  const peerPoint = RistrettoPoint.fromHex(peerMessage)
  if (peerPoint.equals(RistrettoPoint.ZERO)) {
    throw new Error('spake2: peer sent the identity element')
  }

  const peerMask = state.role === 'A' ? N : M
  const shared = peerPoint
    .subtract(peerMask.multiply(state.w))
    .multiply(state.x)
  if (shared.equals(RistrettoPoint.ZERO)) {
    throw new Error('spake2: degenerate shared point')
  }

  // Transcript orders the messages by role (A's first) so both sides agree.
  const pA = state.role === 'A' ? state.myMessage : peerMessage
  const pB = state.role === 'A' ? peerMessage : state.myMessage

  const transcript = concatBytes(
    field(M.toRawBytes()),
    field(N.toRawBytes()),
    field(pA),
    field(pB),
    field(shared.toRawBytes()),
    field(numberToBytesLE(state.w, 32)),
  )
  return sha256(transcript)
}
