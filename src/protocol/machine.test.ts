import { describe, expect, it } from 'vitest'
import {
  initialState,
  reduce,
  type TransferEvent,
  type TransferState,
} from './machine'

function run(events: TransferEvent[], from: TransferState = initialState) {
  return events.reduce(reduce, from)
}

describe('transfer state machine', () => {
  it('walks the sender happy path to complete', () => {
    const end = run([
      { type: 'START_SIGNALING' },
      { type: 'PEER_JOINED' },
      { type: 'SESSION_READY' },
      { type: 'MANIFEST_SENT' },
      { type: 'CONSENT_ACCEPTED' },
      { type: 'TRANSFER_STARTED' },
      { type: 'PROGRESS', bytes: 512 },
      { type: 'EOF' },
      { type: 'VERIFIED' },
    ])
    expect(end.phase).toBe('complete')
    expect(end.bytesTransferred).toBe(512)
  })

  it('walks the receiver happy path (MANIFEST_RECEIVED)', () => {
    const end = run([
      { type: 'START_SIGNALING' },
      { type: 'PEER_JOINED' },
      { type: 'SESSION_READY' },
      { type: 'MANIFEST_RECEIVED' },
      { type: 'CONSENT_ACCEPTED' },
      { type: 'TRANSFER_STARTED' },
      { type: 'EOF' },
      { type: 'VERIFIED' },
    ])
    expect(end.phase).toBe('complete')
  })

  it('ignores out-of-order events (stays put)', () => {
    const s = run([{ type: 'START_SIGNALING' }])
    expect(reduce(s, { type: 'VERIFIED' })).toEqual(s)
    expect(reduce(s, { type: 'EOF' })).toEqual(s)
  })

  it('rejection aborts from the manifest phase', () => {
    const end = run([
      { type: 'START_SIGNALING' },
      { type: 'PEER_JOINED' },
      { type: 'SESSION_READY' },
      { type: 'MANIFEST_RECEIVED' },
      { type: 'CONSENT_REJECTED' },
    ])
    expect(end.phase).toBe('aborted')
  })

  it('fails closed on a whole-file hash mismatch', () => {
    const end = run([
      { type: 'START_SIGNALING' },
      { type: 'PEER_JOINED' },
      { type: 'SESSION_READY' },
      { type: 'MANIFEST_RECEIVED' },
      { type: 'CONSENT_ACCEPTED' },
      { type: 'TRANSFER_STARTED' },
      { type: 'EOF' },
      { type: 'HASH_MISMATCH' },
    ])
    expect(end.phase).toBe('error')
    expect(end.error).toMatch(/hash mismatch/)
  })

  it('a mid-transfer disconnect moves to error', () => {
    const mid = run([
      { type: 'START_SIGNALING' },
      { type: 'PEER_JOINED' },
      { type: 'SESSION_READY' },
      { type: 'MANIFEST_SENT' },
      { type: 'CONSENT_ACCEPTED' },
      { type: 'TRANSFER_STARTED' },
    ])
    expect(reduce(mid, { type: 'DISCONNECTED' }).phase).toBe('error')
  })

  it('ABORT works from any active phase, and terminal states absorb events', () => {
    const mid = run([{ type: 'START_SIGNALING' }, { type: 'PEER_JOINED' }])
    const aborted = reduce(mid, { type: 'ABORT' })
    expect(aborted.phase).toBe('aborted')
    // Terminal: further events are absorbed.
    expect(reduce(aborted, { type: 'SESSION_READY' })).toEqual(aborted)
    expect(reduce(aborted, { type: 'ERROR', message: 'x' })).toEqual(aborted)
  })
})
