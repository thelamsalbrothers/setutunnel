import { sha256 } from '@noble/hashes/sha2'

/**
 * Short-code pairing (CLAUDE.md §4.3, short-code mode). A code looks like
 * `742-otter-anvil`:
 *   - the leading **nameplate** (`742`) is a *non-secret* rendezvous id — it
 *     routes the two peers and becomes the opaque roomId (hashed);
 *   - the **words** (`otter-anvil`) are the SPAKE2 password.
 *
 * SECURITY INVARIANT: the password words must NEVER feed the roomId. The roomId
 * is derived from the nameplate ALONE, so the value the server sees leaks nothing
 * about the password — otherwise the code would be brute-forceable offline,
 * defeating the whole point of the PAKE. The words never leave the device except
 * inside the SPAKE2 exchange (which reveals no guessable value, §4.3).
 */

const ROOM_ID_BYTES = 8
const PLUS = String.fromCharCode(43)
const SLASH = String.fromCharCode(47)
const DASH = String.fromCharCode(45)
const UNDERSCORE = String.fromCharCode(95)
const EQUALS = String.fromCharCode(61)

/**
 * ~128 short, phonetically-distinct words (~7 bits each). Two words ⇒ ~14 bits
 * of password entropy — low, but SPAKE2 makes guessing **online-only** (one
 * attempt per live pairing) and the out-of-band SAS backstops a MITM, so a
 * casual "read it across the room" code is safe for this threat model.
 */
const WORDS: readonly string[] =
  `otter anvil maple river cobra ember delta fjord glide harbor ivory jungle kettle lantern meadow nectar ocean pebble quartz raven summit tundra umbra velvet walnut xenon yonder zephyr amber basil cedar dune eagle fable garnet hazel indigo jasper koala lilac mango noble opal panda quill robin sable topaz union violet willow yeti zebra acorn birch clover domino echo flute grape heron iris jade kiwi lemon mint nova olive plum quiet reed sage tiger urban vine wren yam zinc arbor bison comet daisy elm frost gecko honey inlet jolt karma lotus moss nimbus orbit pearl quest rune slate torch ultra vault wave yield zenith azure bloom coral drift elk fern glow hawk ink jewel kelp lark mesa nest onyx pilot quark ridge storm tulip vivid wisp yarn zeal`.split(
    ' ',
  )

/** Uniform integer in [0, bound) via rejection sampling (no modulo bias). */
function randomInt(bound: number): number {
  const limit = Math.floor(0x100000000 / bound) * bound
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % bound
  }
}

function randomWord(): string {
  return WORDS[randomInt(WORDS.length)]
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
    .replaceAll(PLUS, DASH)
    .replaceAll(SLASH, UNDERSCORE)
    .replaceAll(EQUALS, '')
}

/** Opaque roomId from the *nameplate only* (never the password words). */
function nameplateRoomId(nameplate: string): string {
  const digest = sha256(
    new TextEncoder().encode(`setu/nameplate/v1/${nameplate}`),
  )
  return base64url(digest.slice(0, ROOM_ID_BYTES))
}

function isDigits(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) {
    if (ch < '0' || ch > '9') return false
  }
  return true
}

export interface ShortCodeParts {
  /** Opaque rendezvous roomId (from the nameplate). */
  roomId: string
  /** The SPAKE2 password (the words). */
  password: string
}

/** Generate a fresh code: 3-digit nameplate + two words, e.g. `742-otter-anvil`. */
export function generateShortCode(): string {
  const nameplate = 100 + randomInt(900) // 100–999
  return `${nameplate}${DASH}${randomWord()}${DASH}${randomWord()}`
}

/**
 * Parse a typed code into its rendezvous roomId and SPAKE2 password. Normalizes
 * case/whitespace so both peers derive the same values. Throws (fail closed) on a
 * malformed code.
 */
export function parseShortCode(input: string): ShortCodeParts {
  const code = input.trim().toLowerCase()
  const dash = code.indexOf(DASH)
  if (dash <= 0) {
    throw new Error('Code should look like "742-otter-anvil".')
  }
  const nameplate = code.slice(0, dash)
  const password = code.slice(dash + 1)
  if (!isDigits(nameplate) || password.length === 0) {
    throw new Error('Code should look like "742-otter-anvil".')
  }
  return { roomId: nameplateRoomId(nameplate), password }
}
