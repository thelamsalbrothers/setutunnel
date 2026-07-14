/**
 * Byte utilities for the crypto layer. Pure, dependency-free, no DOM/Node
 * globals beyond `TextEncoder`. Big-endian encoders build the 96-bit nonces
 * and the AAD described in CLAUDE.md §4.4.
 *
 * Builders return `Uint8Array<ArrayBuffer>` because Web Crypto's TypeScript
 * types require ArrayBuffer-backed views (they exclude `SharedArrayBuffer`);
 * every buffer we construct is ArrayBuffer-backed, so this is exact, not a cast.
 */

export function concatBytes(
  ...arrays: readonly Uint8Array[]
): Uint8Array<ArrayBuffer> {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/** 4-byte big-endian encoding of an unsigned 32-bit integer. */
export function u32be(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`u32be: value out of range: ${value}`)
  }
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return out
}

/** 8-byte big-endian encoding of an unsigned 64-bit integer. */
export function u64be(value: bigint): Uint8Array<ArrayBuffer> {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new RangeError(`u64be: value out of range: ${value}`)
  }
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, value, false)
  return out
}

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text))
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** Standard base64 (for transporting bytes inside a JSON string relay payload). */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += HEX[b]
  return s
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error('fromHex: odd-length string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Coerce any Uint8Array to the ArrayBuffer-backed view Web Crypto's types
 * demand. At runtime our buffers are always ArrayBuffer-backed, so this is a
 * no-op narrowing; it only copies in the (never-hit here) SharedArrayBuffer
 * case. Use at every `crypto.subtle.*` boundary that takes external bytes.
 */
export function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes)
}

/**
 * Constant-time equality for two byte arrays. Use for anything an attacker
 * might probe by timing (auth tags, SAS material) rather than `===` on hex.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Best-effort zeroization of sensitive buffers on teardown (§4.6). */
export function zeroize(...buffers: Uint8Array[]): void {
  for (const b of buffers) b.fill(0)
}
