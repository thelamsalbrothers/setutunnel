/**
 * Protocol-wide constants (CLAUDE.md §4.4, §4.7). Kept in one place so the
 * sender, receiver, and manifest validator agree on limits and framing.
 */

export const PROTOCOL_VERSION = 1

/** Default AES-GCM chunk size; tunable within [MIN, MAX] by throughput (§4.4). */
export const DEFAULT_CHUNK_SIZE = 64 * 1024
export const MIN_CHUNK_SIZE = 16 * 1024
export const MAX_CHUNK_SIZE = 256 * 1024

/** Manifest sanity caps — fail closed above these (§4.7). */
export const MAX_FILES = 4096
export const MAX_TOTAL_BYTES = 100 * 1024 ** 3 // 100 GiB
export const MAX_FILENAME_LENGTH = 255
