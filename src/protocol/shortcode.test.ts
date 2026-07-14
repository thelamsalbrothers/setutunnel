import { describe, expect, it } from 'vitest'
import { generateShortCode, parseShortCode } from './shortcode'

describe('short-code pairing', () => {
  it('generates a "<3 digits>-<word>-<word>" code', () => {
    for (let i = 0; i < 50; i++) {
      const parts = generateShortCode().split('-')
      expect(parts).toHaveLength(3)
      expect(parts[0]).toMatch(/^[0-9]{3}$/)
      expect(parts[1].length).toBeGreaterThan(0)
      expect(parts[2].length).toBeGreaterThan(0)
    }
  })

  it('round-trips: parse(generate) yields a roomId + the two words as password', () => {
    const code = generateShortCode()
    const [nameplate, w1, w2] = code.split('-')
    const parsed = parseShortCode(code)
    expect(parsed.password).toBe(`${w1}-${w2}`)
    expect(parsed.roomId.length).toBeGreaterThan(0)
    // roomId is deterministic from the nameplate.
    expect(parseShortCode(`${nameplate}-zzz-yyy`).roomId).toBe(parsed.roomId)
  })

  it('SECURITY: the roomId depends on the nameplate ONLY, never the password', () => {
    // Same nameplate, different password words → identical roomId (so the
    // server-visible roomId leaks nothing about the password).
    expect(parseShortCode('742-otter-anvil').roomId).toBe(
      parseShortCode('742-cobra-delta').roomId,
    )
    // Different nameplate → different roomId.
    expect(parseShortCode('742-otter-anvil').roomId).not.toBe(
      parseShortCode('900-otter-anvil').roomId,
    )
  })

  it('normalizes case and surrounding whitespace', () => {
    const a = parseShortCode('  742-Otter-Anvil  ')
    const b = parseShortCode('742-otter-anvil')
    expect(a.roomId).toBe(b.roomId)
    expect(a.password).toBe(b.password)
  })

  it('rejects malformed codes (fail closed)', () => {
    expect(() => parseShortCode('otter-anvil')).toThrow() // no numeric nameplate
    expect(() => parseShortCode('742')).toThrow() // no words
    expect(() => parseShortCode('742-')).toThrow() // empty password
    expect(() => parseShortCode('')).toThrow()
  })
})
