import { describe, expect, it } from 'vitest'
import { toHex } from './bytes'
import { finishSpake2, startSpake2 } from './spake2'

const CODE = '7-otter-anvil'
// Deterministic scalars for the known-answer vector (production is random).
const XA = 111111111111n
const XB = 222222222222n

describe('SPAKE2 short-code PAKE', () => {
  it('matches the locked known-answer vector', () => {
    const a = startSpake2('A', CODE, XA)
    const b = startSpake2('B', CODE, XB)
    expect(toHex(a.message)).toBe(
      '08f28cd8ef2586a1a78798211eeb154cbaee8479adf21008d8fb0616f4332208',
    )
    expect(toHex(b.message)).toBe(
      '1a35bb69a1cecd4db74945cd791e50ac428db84dce60ced54a97c2a02c583033',
    )
    const s = finishSpake2(a.state, b.message)
    expect(toHex(s)).toBe(
      'fe6ae33e274cb8d4b6484cf9bd5f30c38eb9b62b4b1dc78f31ee430bcbb7b560',
    )
  })

  it('both peers derive the same S from the same code', () => {
    const a = startSpake2('A', CODE)
    const b = startSpake2('B', CODE)
    const sA = finishSpake2(a.state, b.message)
    const sB = finishSpake2(b.state, a.message)
    expect(toHex(sA)).toBe(toHex(sB))
    expect(sA).toHaveLength(32)
  })

  it('diverges when the codes differ (wrong code → different S → fails closed)', () => {
    const a = startSpake2('A', 'correct-code')
    const b = startSpake2('B', 'wrong-code')
    const sA = finishSpake2(a.state, b.message)
    const sB = finishSpake2(b.state, a.message)
    expect(toHex(sA)).not.toBe(toHex(sB))
  })

  it('produces fresh messages per run (random ephemeral scalar)', () => {
    const one = startSpake2('A', CODE)
    const two = startSpake2('A', CODE)
    expect(toHex(one.message)).not.toBe(toHex(two.message))
  })

  it('rejects a malformed peer message (fail closed)', () => {
    const a = startSpake2('A', CODE, XA)
    expect(() => finishSpake2(a.state, new Uint8Array(32).fill(0xff))).toThrow()
  })

  it('rejects the identity element as a peer message', () => {
    const a = startSpake2('A', CODE, XA)
    // ristretto255 encodes the identity as 32 zero bytes.
    expect(() => finishSpake2(a.state, new Uint8Array(32))).toThrow(/identity/)
  })

  it('is symmetric across roles for the shared secret', () => {
    // Same code, swap who is A/B — the pair still agrees within each run.
    const a = startSpake2('A', 'xyz', 5n)
    const b = startSpake2('B', 'xyz', 9n)
    expect(toHex(finishSpake2(a.state, b.message))).toBe(
      toHex(finishSpake2(b.state, a.message)),
    )
  })
})
