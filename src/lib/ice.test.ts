import { describe, expect, it } from 'vitest'
import { DEFAULT_ICE_SERVERS } from '../transport/webrtc'
import { type IceEnv, resolveIceServers } from './ice'

describe('resolveIceServers', () => {
  it('falls back to public STUN when nothing is configured', () => {
    expect(resolveIceServers({})).toEqual(DEFAULT_ICE_SERVERS)
  })

  it('uses a full VITE_ICE_SERVERS JSON array verbatim', () => {
    const env: IceEnv = {
      VITE_ICE_SERVERS: JSON.stringify([
        { urls: 'stun:stun.example.org:3478' },
        {
          urls: ['turn:turn.example.org:3478', 'turns:turn.example.org:5349'],
          username: 'alice',
          credential: 'secret',
        },
      ]),
    }
    expect(resolveIceServers(env)).toEqual([
      { urls: 'stun:stun.example.org:3478' },
      {
        urls: ['turn:turn.example.org:3478', 'turns:turn.example.org:5349'],
        username: 'alice',
        credential: 'secret',
      },
    ])
  })

  it('ignores malformed JSON and falls through to the default', () => {
    expect(resolveIceServers({ VITE_ICE_SERVERS: '{not json' })).toEqual(
      DEFAULT_ICE_SERVERS,
    )
  })

  it('ignores an empty JSON array and falls through', () => {
    expect(resolveIceServers({ VITE_ICE_SERVERS: '[]' })).toEqual(
      DEFAULT_ICE_SERVERS,
    )
  })

  it('builds a STUN entry from a comma-separated list', () => {
    const env: IceEnv = {
      VITE_STUN_URLS: 'stun:a.example:3478, stun:b.example:3478',
    }
    expect(resolveIceServers(env)).toEqual([
      { urls: ['stun:a.example:3478', 'stun:b.example:3478'] },
    ])
  })

  it('builds a TURN entry with credentials alongside STUN', () => {
    const env: IceEnv = {
      VITE_STUN_URLS: 'stun:a.example:3478',
      VITE_TURN_URLS: 'turn:t.example:3478,turns:t.example:5349',
      VITE_TURN_USERNAME: 'bob',
      VITE_TURN_CREDENTIAL: 'pw',
    }
    expect(resolveIceServers(env)).toEqual([
      { urls: ['stun:a.example:3478'] },
      {
        urls: ['turn:t.example:3478', 'turns:t.example:5349'],
        username: 'bob',
        credential: 'pw',
      },
    ])
  })

  it('supports TURN-only configuration', () => {
    const env: IceEnv = {
      VITE_TURN_URLS: 'turn:t.example:3478',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'c',
    }
    expect(resolveIceServers(env)).toEqual([
      { urls: ['turn:t.example:3478'], username: 'u', credential: 'c' },
    ])
  })
})
