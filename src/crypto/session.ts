import { utf8 } from './bytes'
import {
  deriveAesKey,
  deriveBytes,
  importIkm,
  LABEL_A_TO_B,
  LABEL_B_TO_A,
  LABEL_SAS,
} from './hkdf'
import { computeSAS, type Sas } from './sas'

/**
 * Session derivation (CLAUDE.md §4.3). Given the pairing secret S, the X25519
 * shared secret K_dh, and the room id (HKDF salt), both peers independently
 * derive the same pair of direction-separated AES keys and the same SAS. The
 * `role` decides which direction key is "send" vs "recv" for this peer.
 */

/** Direction ids mixed into the 96-bit nonce prefix (§4.4). */
export const DIRECTION_A_TO_B = 1
export const DIRECTION_B_TO_A = 2

/** Room creator (offerer) = 'A'; joiner (answerer) = 'B'. */
export type Role = 'A' | 'B'

export interface DeriveSessionParams {
  /** Pairing secret S: the 256-bit hash-fragment value or the PAKE output. */
  pairingSecret: Uint8Array
  /** K_dh = X25519(mySecret, theirPublic). */
  sharedSecret: Uint8Array
  /** Room id, used as the HKDF salt. */
  roomId: string | Uint8Array
  /** Which side of the tunnel this peer is. */
  role: Role
}

export interface Session {
  /** AES-256-GCM key for this peer's outgoing chunks. */
  sendKey: CryptoKey
  /** AES-256-GCM key for this peer's incoming chunks. */
  recvKey: CryptoKey
  /** 4-byte direction id mixed into outgoing nonces. */
  sendDirectionId: number
  /** 4-byte direction id mixed into incoming nonces. */
  recvDirectionId: number
  /** Short Authentication String for out-of-band MITM detection. */
  sas: Sas
}

export async function deriveSession(
  params: DeriveSessionParams,
): Promise<Session> {
  const salt =
    typeof params.roomId === 'string' ? utf8(params.roomId) : params.roomId
  const ikmKey = await importIkm(params.pairingSecret, params.sharedSecret)

  const [keyAtoB, keyBtoA, sasBytes] = await Promise.all([
    deriveAesKey(ikmKey, salt, LABEL_A_TO_B),
    deriveAesKey(ikmKey, salt, LABEL_B_TO_A),
    deriveBytes(ikmKey, salt, LABEL_SAS, 4),
  ])

  const isA = params.role === 'A'
  return {
    sendKey: isA ? keyAtoB : keyBtoA,
    recvKey: isA ? keyBtoA : keyAtoB,
    sendDirectionId: isA ? DIRECTION_A_TO_B : DIRECTION_B_TO_A,
    recvDirectionId: isA ? DIRECTION_B_TO_A : DIRECTION_A_TO_B,
    sas: computeSAS(sasBytes),
  }
}
