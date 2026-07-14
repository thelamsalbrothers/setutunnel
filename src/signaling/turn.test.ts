import { describe, expect, it } from 'vitest'
import { buildTurnPayload, mintTurnCredential } from './turn'

describe('mintTurnCredential (coturn TURN REST API)', () => {
  const SECRET = 'setutunnel-test-secret'

  it('matches an independent HMAC-SHA1 golden vector', async () => {
    // Golden value generated out-of-band with Node's crypto.createHmac('sha1')
    // over username "1700003600" — an independent check on the crypto.subtle path.
    const cred = await mintTurnCredential(SECRET, 3600, 1_700_000_000)
    expect(cred.username).toBe('1700003600')
    expect(cred.credential).toBe('7oBoqrTDEOBptNsaHjaACEz8PbA=')
    expect(cred.ttl).toBe(3600)
  })

  it('embeds an optional label in the username', async () => {
    const cred = await mintTurnCredential(SECRET, 100, 500, 'peerA')
    expect(cred.username).toBe('600:peerA')
  })

  it('is deterministic for the same inputs and varies with the secret', async () => {
    const a = await mintTurnCredential('one', 100, 1000)
    const b = await mintTurnCredential('one', 100, 1000)
    const c = await mintTurnCredential('two', 100, 1000)
    expect(a.credential).toBe(b.credential)
    expect(a.credential).not.toBe(c.credential)
  })
})

describe('buildTurnPayload', () => {
  it('returns null unless both urls and secret are configured', async () => {
    expect(await buildTurnPayload({}, 0)).toBeNull()
    expect(await buildTurnPayload({ urls: 'turn:x:3478' }, 0)).toBeNull()
    expect(await buildTurnPayload({ secret: 's' }, 0)).toBeNull()
    expect(await buildTurnPayload({ urls: '  ', secret: 's' }, 0)).toBeNull()
  })

  it('parses the URL list and mints a matching credential', async () => {
    const payload = await buildTurnPayload(
      { urls: 'turn:a:3478, turns:a:5349', secret: 'sekret', ttlSeconds: 100 },
      500,
    )
    if (payload === null) throw new Error('expected a payload')
    expect(payload.urls).toEqual(['turn:a:3478', 'turns:a:5349'])
    expect(payload.username).toBe('600')
    expect(payload.ttl).toBe(100)
    const direct = await mintTurnCredential('sekret', 100, 500)
    expect(payload.credential).toBe(direct.credential)
  })

  it('defaults the TTL to 24h when unset', async () => {
    const payload = await buildTurnPayload(
      { urls: 'turn:a:3478', secret: 's' },
      0,
    )
    if (payload === null) throw new Error('expected a payload')
    expect(payload.ttl).toBe(86_400)
  })
})
