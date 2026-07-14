import { asBufferSource } from '../crypto/bytes'

/** Save received bytes to the user's device (§6E fallback 4 — in-memory blob). */
export function downloadBlob(
  parts: Uint8Array[],
  filename: string,
  type: string,
) {
  const blob = new Blob(
    parts.map((part) => asBufferSource(part)),
    { type: type || 'application/octet-stream' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'download'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
