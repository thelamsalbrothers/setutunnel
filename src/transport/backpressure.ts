import type { DataChannelLike } from './channel'

/**
 * Backpressure gate (CLAUDE.md §6D). This is what lets multi-GB transfers
 * survive: we never let the DataChannel's send buffer grow without bound. When
 * `bufferedAmount` reaches the high-water mark we pause and await the
 * `bufferedamountlow` event before sending more, so producer speed tracks the
 * link's real drain rate instead of blowing up RAM.
 */

/** Pause sending once this many bytes are buffered (default 8 MiB). */
export const DEFAULT_HIGH_WATER = 8 * 1024 * 1024

export async function sendWithBackpressure(
  channel: DataChannelLike,
  data: Uint8Array,
  highWater: number = DEFAULT_HIGH_WATER,
): Promise<void> {
  if (channel.readyState !== 'open') {
    throw new Error(`backpressure: channel not open (${channel.readyState})`)
  }

  if (channel.bufferedAmount >= highWater) {
    channel.bufferedAmountLowThreshold = Math.floor(highWater / 2)
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        channel.removeEventListener('bufferedamountlow', onLow)
        channel.removeEventListener('close', onClose)
        channel.removeEventListener('error', onClose)
      }
      const onLow = () => {
        cleanup()
        resolve()
      }
      // If the channel closes/errors while we're parked, `bufferedamountlow`
      // would never fire — reject so the send loop unwinds instead of hanging.
      const onClose = () => {
        cleanup()
        reject(new Error('backpressure: channel closed while draining'))
      }
      channel.addEventListener('bufferedamountlow', onLow)
      channel.addEventListener('close', onClose)
      channel.addEventListener('error', onClose)
      // Guard the race: it may have closed between the check above and now.
      if (channel.readyState !== 'open') onClose()
    })
  }

  channel.send(data)
}
