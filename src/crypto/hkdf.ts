import { asBufferSource, concatBytes, utf8 } from './bytes'

/**
 * HKDF-SHA256 key schedule (CLAUDE.md §4.3), implemented with Web Crypto only
 * (§4.6). Web Crypto's HKDF performs Expand(Extract(salt, IKM), info, L) in a
 * single `deriveBits`/`deriveKey` call. Because Extract is deterministic in
 * (salt, IKM), calling it three times with the same salt + IKM but different
 * `info` reproduces exactly the spec's "extract once → expand per label"
 * schedule — the imported IKM key holds S ‖ K_dh, and each label expands from
 * the same PRK.
 *
 * Direction-separation labels. NOTE the literal '→' (U+2192, UTF-8 E2 86 92):
 * these byte strings are part of the wire contract, so any reimplementation
 * must encode them identically.
 */
export const LABEL_A_TO_B: Uint8Array = utf8('setu/a→b')
export const LABEL_B_TO_A: Uint8Array = utf8('setu/b→a')
export const LABEL_SAS: Uint8Array = utf8('setu/sas')

const HASH = 'SHA-256'

/** Import IKM = S ‖ K_dh as a non-extractable HKDF base key. */
export async function importIkm(
  pairingSecret: Uint8Array,
  sharedSecret: Uint8Array,
): Promise<CryptoKey> {
  const ikm = concatBytes(pairingSecret, sharedSecret)
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])
  // importKey copied the material internally; drop our plaintext copy.
  ikm.fill(0)
  return key
}

/** Expand a direction key as a non-extractable AES-256-GCM CryptoKey (§4.6). */
export function deriveAesKey(
  ikmKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: HASH,
      salt: asBufferSource(salt),
      info: asBufferSource(info),
    },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Expand raw bytes for a label (used for the SAS material). */
export async function deriveBytes(
  ikmKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: HASH,
      salt: asBufferSource(salt),
      info: asBufferSource(info),
    },
    ikmKey,
    length * 8,
  )
  return new Uint8Array(bits)
}
