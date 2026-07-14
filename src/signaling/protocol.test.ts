import { describe, expect, it } from 'vitest'
import { MAX_RELAY_PAYLOAD, parseClientMessage } from './protocol'

describe('parseClientMessage (untrusted input, fail closed)', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"type":"create","roomId":"r1"}')).toEqual({
      type: 'create',
      roomId: 'r1',
    })
    expect(parseClientMessage('{"type":"join","roomId":"r1"}')).toEqual({
      type: 'join',
      roomId: 'r1',
    })
    expect(parseClientMessage('{"type":"relay","payload":"blob"}')).toEqual({
      type: 'relay',
      payload: 'blob',
    })
    expect(parseClientMessage('{"type":"leave"}')).toEqual({ type: 'leave' })
  })

  it('rejects malformed JSON and non-objects', () => {
    expect(parseClientMessage('not json')).toBeNull()
    expect(parseClientMessage('42')).toBeNull()
    expect(parseClientMessage('null')).toBeNull()
  })

  it('rejects unknown types and missing fields', () => {
    expect(parseClientMessage('{"type":"nuke"}')).toBeNull()
    expect(parseClientMessage('{"type":"create"}')).toBeNull()
    expect(parseClientMessage('{"type":"create","roomId":123}')).toBeNull()
    expect(parseClientMessage('{"type":"relay"}')).toBeNull()
  })

  it('rejects an oversized relay payload', () => {
    const big = 'x'.repeat(MAX_RELAY_PAYLOAD + 1)
    expect(
      parseClientMessage(JSON.stringify({ type: 'relay', payload: big })),
    ).toBeNull()
  })

  it('rejects an empty or oversized roomId', () => {
    expect(parseClientMessage('{"type":"create","roomId":""}')).toBeNull()
    const big = 'r'.repeat(1000)
    expect(
      parseClientMessage(JSON.stringify({ type: 'join', roomId: big })),
    ).toBeNull()
  })
})
