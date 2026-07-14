import { describe, expect, it } from 'vitest'
import { fromHex } from './bytes'
import { computeSAS } from './sas'

describe('SAS derivation', () => {
  it('is deterministic and stable (locked vector)', () => {
    const sas = computeSAS(fromHex('deadbeef'))
    expect(sas.number).toBe('928559')
    expect(sas.emoji).toHaveLength(5)
    expect(sas.emoji.join('')).toBe('🍕🔥🍔🎨🚀')
  })

  it('differs for different inputs', () => {
    const a = computeSAS(fromHex('00000000'))
    const b = computeSAS(fromHex('ffffffff'))
    expect(a.number).not.toBe(b.number)
    expect(a.emoji.join('')).not.toBe(b.emoji.join(''))
  })

  it('rejects short input (fail closed)', () => {
    expect(() => computeSAS(fromHex('0011'))).toThrow()
  })
})
