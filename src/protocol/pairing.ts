/**
 * Link / QR pairing (CLAUDE.md §4.3, Link/QR mode). The pairing secret S is 256
 * bits of CSPRNG output and travels ONLY in the URL hash fragment
 * (`…/r/<roomId>#<S>`). Browsers never send the fragment to the server, so S
 * stays client-side — the whole basis of zero-knowledge pairing. The roomId is
 * a separate random value used purely to route the two peers.
 *
 * SECURITY INVARIANT: S must never appear in the path or query string. The
 * `buildPairingUrl`/`parsePairingUrl` pair enforces this and it is asserted in
 * the tests.
 */

const SECRET_BYTES = 32 // 256-bit S
const ROOM_ID_BYTES = 8

const PLUS = String.fromCharCode(43) // '+'
const SLASH = String.fromCharCode(47) // '/'
const DASH = String.fromCharCode(45) // '-'
const UNDERSCORE = String.fromCharCode(95) // '_'
const EQUALS = String.fromCharCode(61) // '='

export interface Pairing {
  roomId: string
  /** The pairing secret S (32 bytes). Never send this to the server. */
  secret: Uint8Array
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
    .replaceAll(PLUS, DASH)
    .replaceAll(SLASH, UNDERSCORE)
    .replaceAll(EQUALS, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll(DASH, PLUS).replaceAll(UNDERSCORE, SLASH)
  const padLength = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4)
  const binary = atob(b64 + EQUALS.repeat(padLength))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Generate a fresh pairing: random roomId + 256-bit secret S. */
export function generatePairing(): Pairing {
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
  const roomIdBytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_BYTES))
  return { roomId: toBase64Url(roomIdBytes), secret }
}

/**
 * Build the shareable URL. `base` supplies the origin (e.g. the app's own
 * `location.origin`). S is placed in the hash fragment only.
 */
export function buildPairingUrl(base: string, pairing: Pairing): string {
  const url = new URL(base)
  url.pathname = `/r/${pairing.roomId}`
  url.search = ''
  url.hash = toBase64Url(pairing.secret)
  return url.toString()
}

/**
 * Parse a pairing URL back into { roomId, secret }. Reads S from the hash
 * fragment. Fails closed (throws) if the room segment or secret is missing or
 * malformed — a transfer must not proceed without a well-formed secret.
 */
export function parsePairingUrl(url: string): Pairing {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/[/]r[/]([^/]+)[/]?$/)
  if (!match) {
    throw new Error('parsePairingUrl: missing /r/<roomId> path')
  }
  const roomId = match[1]

  const rawHash = parsed.hash
  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  if (hash === '') {
    throw new Error('parsePairingUrl: missing secret in hash fragment')
  }

  const secret = fromBase64Url(hash)
  if (secret.length !== SECRET_BYTES) {
    throw new Error(
      `parsePairingUrl: secret must be ${SECRET_BYTES} bytes, got ${secret.length}`,
    )
  }
  return { roomId, secret }
}
