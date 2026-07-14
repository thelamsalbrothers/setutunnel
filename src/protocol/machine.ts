/**
 * Transfer lifecycle state machine (CLAUDE.md §6B) as a pure typed reducer.
 * Every transition is explicit and testable; unknown events are ignored (the
 * machine stays put) rather than throwing, except that ERROR / ABORT /
 * DISCONNECTED always move an active transfer to a terminal state — fail closed,
 * never silently continue in a bad state.
 *
 * Phases follow §3: signaling → connecting → connected → manifest exchange →
 * consent → streaming → whole-file hash verification → done.
 */

export type TransferPhase =
  | 'idle'
  | 'signaling' // exchanging encrypted SDP/ICE via the server
  | 'connecting' // ICE/DTLS establishing; DataChannel not yet open
  | 'connected' // channel open + session keys derived (SAS known)
  | 'manifest' // sender sent / receiver awaiting-consent on the manifest
  | 'consented' // receiver accepted; ready to stream
  | 'transferring' // streaming AES-GCM chunks
  | 'verifying' // EOF received; checking the whole-file hash
  | 'complete' // hash verified
  | 'aborted' // user/peer abort or consent rejection
  | 'error' // any failure — surfaced, never downgraded

const TERMINAL: ReadonlySet<TransferPhase> = new Set([
  'complete',
  'aborted',
  'error',
])

export type TransferEvent =
  | { type: 'START_SIGNALING' }
  | { type: 'PEER_JOINED' }
  | { type: 'SESSION_READY' } // DataChannel open + keys derived
  | { type: 'MANIFEST_SENT' } // sender
  | { type: 'MANIFEST_RECEIVED' } // receiver
  | { type: 'CONSENT_ACCEPTED' }
  | { type: 'CONSENT_REJECTED' }
  | { type: 'TRANSFER_STARTED' }
  | { type: 'PROGRESS'; bytes: number }
  | { type: 'EOF' }
  | { type: 'VERIFIED' }
  | { type: 'HASH_MISMATCH' }
  | { type: 'ABORT' }
  | { type: 'DISCONNECTED' }
  | { type: 'ERROR'; message: string }

export interface TransferState {
  phase: TransferPhase
  bytesTransferred: number
  error?: string
}

export const initialState: TransferState = {
  phase: 'idle',
  bytesTransferred: 0,
}

function isTerminal(phase: TransferPhase): boolean {
  return TERMINAL.has(phase)
}

/** Advance the machine. Pure: returns a new state, never mutates. */
export function reduce(
  state: TransferState,
  event: TransferEvent,
): TransferState {
  // Terminal states absorb everything.
  if (isTerminal(state.phase)) return state

  // Global failure/teardown events apply from any active phase (§6B ungraceful
  // teardown). Checked first so they can't be missed by a phase branch.
  switch (event.type) {
    case 'ERROR':
      return { ...state, phase: 'error', error: event.message }
    case 'ABORT':
      return { ...state, phase: 'aborted' }
    case 'DISCONNECTED':
      if (state.phase !== 'idle') {
        return { ...state, phase: 'error', error: 'peer disconnected' }
      }
      return state
    default:
      break
  }

  switch (state.phase) {
    case 'idle':
      if (event.type === 'START_SIGNALING') {
        return { ...state, phase: 'signaling' }
      }
      break
    case 'signaling':
      if (event.type === 'PEER_JOINED') {
        return { ...state, phase: 'connecting' }
      }
      break
    case 'connecting':
      if (event.type === 'SESSION_READY') {
        return { ...state, phase: 'connected' }
      }
      break
    case 'connected':
      if (
        event.type === 'MANIFEST_SENT' ||
        event.type === 'MANIFEST_RECEIVED'
      ) {
        return { ...state, phase: 'manifest' }
      }
      break
    case 'manifest':
      if (event.type === 'CONSENT_ACCEPTED') {
        return { ...state, phase: 'consented' }
      }
      if (event.type === 'CONSENT_REJECTED') {
        return { ...state, phase: 'aborted' }
      }
      break
    case 'consented':
      if (event.type === 'TRANSFER_STARTED') {
        return { ...state, phase: 'transferring' }
      }
      break
    case 'transferring':
      if (event.type === 'PROGRESS') {
        return { ...state, bytesTransferred: event.bytes }
      }
      if (event.type === 'EOF') {
        return { ...state, phase: 'verifying' }
      }
      break
    case 'verifying':
      if (event.type === 'VERIFIED') {
        return { ...state, phase: 'complete' }
      }
      if (event.type === 'HASH_MISMATCH') {
        return { ...state, phase: 'error', error: 'whole-file hash mismatch' }
      }
      break
    default:
      break
  }

  // Unknown/out-of-order event for this phase: ignore, stay put.
  return state
}
