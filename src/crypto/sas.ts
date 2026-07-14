/**
 * Short Authentication String (CLAUDE.md §4.3). Derived from 4 bytes of HKDF
 * output. Both peers display the same SAS; in short-code mode the users compare
 * it out-of-band (read it aloud) to detect a signaling-server MITM. Presented as
 * both an emoji sequence and a 6-digit number so users can read whichever is
 * easier. The emoji alphabet order and the bit layout are part of the wire
 * contract — do not change them without regenerating the golden vectors.
 */

// 64-emoji alphabet (6 bits per symbol). Kept to distinct, single-glyph emoji.
const SAS_EMOJI: readonly string[] = [
  '😀',
  '😎',
  '🤖',
  '👻',
  '🐶',
  '🐱',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🦁',
  '🐯',
  '🦄',
  '🐸',
  '🐵',
  '🐔',
  '🦉',
  '🦅',
  '🐝',
  '🦋',
  '🐢',
  '🐙',
  '🦑',
  '🦀',
  '🐠',
  '🐬',
  '🐳',
  '🐍',
  '🦎',
  '🦈',
  '🦖',
  '🦕',
  '🌵',
  '🌲',
  '🍀',
  '🌸',
  '🌻',
  '🍁',
  '🍄',
  '🌍',
  '🌙',
  '⭐',
  '🔥',
  '🌈',
  '🌊',
  '🍎',
  '🍌',
  '🍓',
  '🍉',
  '🍇',
  '🍒',
  '🥝',
  '🌽',
  '🥕',
  '🍔',
  '🍕',
  '🎁',
  '🎈',
  '🎸',
  '🚀',
  '⚽',
  '🏀',
  '🎨',
  '🔔',
]

export interface Sas {
  /** Five emoji from the top 30 bits of the SAS material (6 bits each). */
  emoji: string[]
  /** Six-digit decimal string, zero-padded. */
  number: string
}

export function computeSAS(bytes: Uint8Array): Sas {
  if (bytes.length < 4) {
    throw new Error('computeSAS: need at least 4 bytes of SAS material')
  }
  const n =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  const emoji = [
    SAS_EMOJI[(n >>> 26) & 0x3f],
    SAS_EMOJI[(n >>> 20) & 0x3f],
    SAS_EMOJI[(n >>> 14) & 0x3f],
    SAS_EMOJI[(n >>> 8) & 0x3f],
    SAS_EMOJI[(n >>> 2) & 0x3f],
  ]
  const number = (n % 1_000_000).toString().padStart(6, '0')
  return { emoji, number }
}
