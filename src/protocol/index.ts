/**
 * Module B — Protocol (CLAUDE.md §6). Shared wire types, the transfer state
 * machine, manifest validation + content-safety, and Link/QR pairing. Pure and
 * framework-agnostic (no React/DOM beyond Web Crypto + URL).
 */
export {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MIN_CHUNK_SIZE,
  PROTOCOL_VERSION,
} from './constants'
export {
  initialState,
  reduce,
  type TransferEvent,
  type TransferPhase,
  type TransferState,
} from './machine'
export {
  assessFile,
  buildManifest,
  type SafetyVerdict,
  sanitizePath,
  validateManifest,
} from './manifest'
export type {
  AcceptMessage,
  AckMessage,
  ControlMessage,
  ControlMessageType,
  EofMessage,
  ErrorMessage,
  FileEntry,
  ManifestMessage,
  RejectMessage,
} from './messages'
export {
  buildPairingUrl,
  generatePairing,
  type Pairing,
  parsePairingUrl,
} from './pairing'
