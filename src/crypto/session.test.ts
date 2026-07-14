import { describe, expect, it } from 'vitest'
import { decryptChunk, encryptChunk } from './aead'
import { fromHex, toHex, utf8 } from './bytes'
import { computeSharedSecret } from './keypair'
import { deriveSession } from './session'

// Fixed X25519 keys (RFC 7748) so K_dh — and therefore the whole session — is
// deterministic across runs.
const ALICE_PRIV = fromHex(
  '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
)
const ALICE_PUB = fromHex(
  '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
)
const BOB_PRIV = fromHex(
  '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
)
const BOB_PUB = fromHex(
  'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
)
const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)
const ROOM = 'setu-room-01'
const TRANSFER = utf8('t')

async function pair() {
  const kdhA = computeSharedSecret(ALICE_PRIV, BOB_PUB)
  const kdhB = computeSharedSecret(BOB_PRIV, ALICE_PUB)
  const a = await deriveSession({
    pairingSecret: S,
    sharedSecret: kdhA,
    roomId: ROOM,
    role: 'A',
  })
  const b = await deriveSession({
    pairingSecret: S,
    sharedSecret: kdhB,
    roomId: ROOM,
    role: 'B',
  })
  return { a, b }
}

describe('deriveSession', () => {
  it('A and B agree on SAS and mirror direction ids', async () => {
    const { a, b } = await pair()
    expect(a.sas.number).toBe(b.sas.number)
    expect(a.sas.emoji).toEqual(b.sas.emoji)
    expect(a.sendDirectionId).toBe(b.recvDirectionId)
    expect(a.recvDirectionId).toBe(b.sendDirectionId)
  })

  it('locks the derived SAS (regression anchor)', async () => {
    const { a } = await pair()
    expect(a.sas.number).toBe('396896')
    expect(a.sas.emoji.join('')).toBe('🦕🐨🌸🌊🎁')
  })

  it("A's send key decrypts on B's recv key, and vice versa", async () => {
    const { a, b } = await pair()

    const msgAB = utf8('ping from A')
    const ctAB = await encryptChunk(
      {
        key: a.sendKey,
        directionId: a.sendDirectionId,
        counter: 0n,
        transferId: TRANSFER,
        chunkIndex: 0n,
        isFinal: false,
      },
      msgAB,
    )
    const gotAB = await decryptChunk(
      {
        key: b.recvKey,
        directionId: b.recvDirectionId,
        counter: 0n,
        transferId: TRANSFER,
        chunkIndex: 0n,
        isFinal: false,
      },
      ctAB,
    )
    expect(toHex(gotAB)).toBe(toHex(msgAB))

    const msgBA = utf8('pong from B')
    const ctBA = await encryptChunk(
      {
        key: b.sendKey,
        directionId: b.sendDirectionId,
        counter: 0n,
        transferId: TRANSFER,
        chunkIndex: 0n,
        isFinal: false,
      },
      msgBA,
    )
    const gotBA = await decryptChunk(
      {
        key: a.recvKey,
        directionId: a.recvDirectionId,
        counter: 0n,
        transferId: TRANSFER,
        chunkIndex: 0n,
        isFinal: false,
      },
      ctBA,
    )
    expect(toHex(gotBA)).toBe(toHex(msgBA))
  })

  it('a different pairing secret produces a non-interoperable session', async () => {
    const kdh = computeSharedSecret(ALICE_PRIV, BOB_PUB)
    const good = await deriveSession({
      pairingSecret: S,
      sharedSecret: kdh,
      roomId: ROOM,
      role: 'A',
    })
    const wrongSecret = fromHex(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    )
    const bad = await deriveSession({
      pairingSecret: wrongSecret,
      sharedSecret: computeSharedSecret(BOB_PRIV, ALICE_PUB),
      roomId: ROOM,
      role: 'B',
    })

    expect(good.sas.number).not.toBe(bad.sas.number)

    const ct = await encryptChunk(
      {
        key: good.sendKey,
        directionId: good.sendDirectionId,
        counter: 0n,
        transferId: TRANSFER,
        chunkIndex: 0n,
        isFinal: false,
      },
      utf8('secret'),
    )
    await expect(
      decryptChunk(
        {
          key: bad.recvKey,
          directionId: bad.recvDirectionId,
          counter: 0n,
          transferId: TRANSFER,
          chunkIndex: 0n,
          isFinal: false,
        },
        ct,
      ),
    ).rejects.toThrow()
  })
})
