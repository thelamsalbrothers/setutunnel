/**
 * Regenerates the locked known-answer vectors embedded in the crypto tests.
 * Run with `bun scripts/gen-crypto-vectors.ts` after an intentional crypto
 * change, then paste the printed values into the corresponding *.test.ts.
 * (Not part of the app/tsc build — lives outside the tsconfig include set.)
 */

import { encryptChunk } from '../src/crypto/aead'
import { fromHex, toHex, utf8 } from '../src/crypto/bytes'
import { computeSharedSecret } from '../src/crypto/keypair'
import { computeSAS } from '../src/crypto/sas'
import { deriveSession } from '../src/crypto/session'

const KEY = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)
const aesKey = await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, [
  'encrypt',
  'decrypt',
])

const kat = await encryptChunk(
  {
    key: aesKey,
    directionId: 1,
    counter: 0n,
    transferId: utf8('setu-transfer'),
    chunkIndex: 0n,
    isFinal: true,
  },
  utf8('setutunnel'),
)

const sas = computeSAS(fromHex('deadbeef'))

const S = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
)
const alicePriv = fromHex(
  '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
)
const bobPub = fromHex(
  'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
)
const kdh = computeSharedSecret(alicePriv, bobPub)
const session = await deriveSession({
  pairingSecret: S,
  sharedSecret: kdh,
  roomId: 'setu-room-01',
  role: 'A',
})

console.log(
  JSON.stringify(
    {
      aeadKat: toHex(kat),
      sasNumber: sas.number,
      sasEmoji: sas.emoji.join(''),
      sessionSasNumber: session.sas.number,
      sessionSasEmoji: session.sas.emoji.join(''),
    },
    null,
    2,
  ),
)
