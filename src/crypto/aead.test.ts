import { describe, expect, it } from 'vitest'
import { type ChunkParams, decryptChunk, encryptChunk } from './aead'
import { fromHex, toHex, utf8 } from './bytes'

const KEY_HEX =
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

function importAesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromHex(KEY_HEX), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

function params(
  key: CryptoKey,
  overrides: Partial<ChunkParams> = {},
): ChunkParams {
  return {
    key,
    directionId: 1,
    counter: 0n,
    transferId: utf8('setu-transfer'),
    chunkIndex: 0n,
    isFinal: false,
    ...overrides,
  }
}

describe('AES-256-GCM chunk AEAD', () => {
  it('round-trips plaintext', async () => {
    const key = await importAesKey()
    const pt = utf8('hello setutunnel')
    const ct = await encryptChunk(params(key), pt)
    const back = await decryptChunk(params(key), ct)
    expect(toHex(back)).toBe(toHex(pt))
  })

  it('fails closed when the nonce counter differs (replay/reorder)', async () => {
    const key = await importAesKey()
    const ct = await encryptChunk(params(key, { counter: 0n }), utf8('x'))
    await expect(
      decryptChunk(params(key, { counter: 1n }), ct),
    ).rejects.toThrow()
  })

  it('fails closed when the AAD differs (truncation/final-flag flip)', async () => {
    const key = await importAesKey()
    const ct = await encryptChunk(
      params(key, { chunkIndex: 5n, isFinal: false }),
      utf8('x'),
    )
    await expect(
      decryptChunk(params(key, { chunkIndex: 5n, isFinal: true }), ct),
    ).rejects.toThrow()
    await expect(
      decryptChunk(params(key, { chunkIndex: 6n, isFinal: false }), ct),
    ).rejects.toThrow()
  })

  it('fails closed on a flipped ciphertext bit (tamper)', async () => {
    const key = await importAesKey()
    const ct = await encryptChunk(params(key), utf8('hello'))
    ct[0] ^= 0x01
    await expect(decryptChunk(params(key), ct)).rejects.toThrow()
  })

  it('matches the locked known-answer vector', async () => {
    const key = await importAesKey()
    const ct = await encryptChunk(
      params(key, {
        directionId: 1,
        counter: 0n,
        chunkIndex: 0n,
        isFinal: true,
      }),
      utf8('setutunnel'),
    )
    expect(toHex(ct)).toBe(
      '3753b9df782f9ac63a508a2a920f0d7b6b3d137790bb00e98f62',
    )
  })
})
