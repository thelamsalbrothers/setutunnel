/**
 * Module A — Cryptography layer (CLAUDE.md §6). Pure and framework-agnostic:
 * no React, no DOM beyond Web Crypto. The public surface intentionally stays
 * small and testable (§6): key agreement, per-chunk AEAD, SAS, streaming hash.
 */

export { type ChunkParams, decryptChunk, encryptChunk } from './aead'
export {
  bytesEqual,
  concatBytes,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
  u32be,
  u64be,
  utf8,
  utf8Decode,
  zeroize,
} from './bytes'
export {
  decryptEnvelope,
  deriveEnvelopeKey,
  ENVELOPE_NONCE_LEN,
  type EnvelopeRole,
  encryptEnvelope,
} from './envelope'
export { createFileHasher, type FileHasher, sha256Once } from './hash'
export {
  computeSharedSecret,
  type EphemeralKeyPair,
  generateKeyPair,
} from './keypair'
export { computeSAS, type Sas } from './sas'
export {
  type DeriveSessionParams,
  DIRECTION_A_TO_B,
  DIRECTION_B_TO_A,
  deriveSession,
  type Role,
  type Session,
} from './session'
export {
  finishSpake2,
  type Spake2Role,
  type Spake2Start,
  type Spake2State,
  startSpake2,
} from './spake2'
