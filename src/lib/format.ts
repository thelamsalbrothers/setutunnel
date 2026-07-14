export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = value >= 100 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  return `${formatBytes(Math.round(bytesPerSec))}/s`
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 1) return '<1s'
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
