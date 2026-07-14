import { describe, expect, it } from 'vitest'
import { sendWithBackpressure } from './backpressure'
import type { DataChannelEvent, DataChannelLike } from './channel'

class FakeChannel implements DataChannelLike {
  readyState: DataChannelLike['readyState'] = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  readonly sent: Uint8Array[] = []
  private readonly listeners: Record<DataChannelEvent, Set<() => void>> = {
    bufferedamountlow: new Set(),
    close: new Set(),
    error: new Set(),
  }

  send(data: Uint8Array): void {
    this.sent.push(data)
    this.bufferedAmount += data.length
  }
  addEventListener(type: DataChannelEvent, listener: () => void): void {
    this.listeners[type].add(listener)
  }
  removeEventListener(type: DataChannelEvent, listener: () => void): void {
    this.listeners[type].delete(listener)
  }
  /** Simulate the network draining `n` bytes; fire the low event if crossed. */
  drain(n: number): void {
    this.bufferedAmount = Math.max(0, this.bufferedAmount - n)
    if (this.bufferedAmount <= this.bufferedAmountLowThreshold) {
      for (const l of [...this.listeners.bufferedamountlow]) l()
    }
  }
  /** Simulate the channel closing under us (fires 'close' listeners). */
  closeNow(): void {
    this.readyState = 'closed'
    for (const l of [...this.listeners.close]) l()
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('sendWithBackpressure', () => {
  it('sends immediately when the buffer is below the high-water mark', async () => {
    const ch = new FakeChannel()
    await sendWithBackpressure(ch, new Uint8Array(10), 100)
    expect(ch.sent).toHaveLength(1)
  })

  it('pauses when the buffer is full and resumes on drain', async () => {
    const ch = new FakeChannel()
    ch.bufferedAmount = 120 // already over the 100-byte high-water mark

    let resolved = false
    const p = sendWithBackpressure(ch, new Uint8Array(10), 100).then(() => {
      resolved = true
    })

    await flush()
    expect(resolved).toBe(false) // still paused
    expect(ch.sent).toHaveLength(0)

    ch.drain(90) // 120 → 30, below the 50-byte low threshold ⇒ fires the event
    await p
    expect(resolved).toBe(true)
    expect(ch.sent).toHaveLength(1)
  })

  it('throws when the channel is not open (fail closed)', async () => {
    const ch = new FakeChannel()
    ch.readyState = 'closed'
    await expect(sendWithBackpressure(ch, new Uint8Array(1))).rejects.toThrow()
  })

  it('rejects a parked wait when the channel closes mid-drain', async () => {
    const ch = new FakeChannel()
    ch.bufferedAmount = 120 // parks immediately

    const settled = sendWithBackpressure(ch, new Uint8Array(10), 100).then(
      () => 'resolved',
      () => 'rejected',
    )
    await flush()
    ch.closeNow() // 'close' fires while parked ⇒ the wait must reject
    expect(await settled).toBe('rejected')
    expect(ch.sent).toHaveLength(0)
  })
})
