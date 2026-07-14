import type { WritableFileSink } from './file-sink'

/**
 * Service-worker streamed download (CLAUDE.md §6E, tier 2). On browsers without
 * the File System Access API (Firefox, Safari), we still get *flat-memory* large
 * receives: we transfer a `ReadableStream` to the /dl/ service worker and kick a
 * hidden-iframe navigation it answers with a streaming attachment, so the
 * browser's native downloader writes to disk incrementally. Backpressure flows
 * back through the transferred stream, so RAM stays bounded.
 */

let registration: ServiceWorkerRegistration | null | undefined
let transferable: boolean | undefined

const BASE = (import.meta.env.BASE_URL || '/') as string

function safeName(name: string): string {
  let out = ''
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 32 && ch !== '"' && ch !== '\\') out += ch
  }
  return out || 'download'
}

/** Can a ReadableStream be transferred to the worker? (FF 103+, Safari 16.4+.) */
function supportsTransferableStreams(): boolean {
  if (transferable !== undefined) return transferable
  try {
    const stream = new ReadableStream()
    const channel = new MessageChannel()
    channel.port1.postMessage(stream, [stream as unknown as Transferable])
    channel.port1.close()
    channel.port2.close()
    transferable = true
  } catch {
    transferable = false
  }
  return transferable
}

/** True when a service-worker streamed download can be used. */
export function swStreamingAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof ReadableStream !== 'undefined' &&
    typeof TransformStream !== 'undefined' &&
    typeof MessageChannel !== 'undefined' &&
    globalThis.isSecureContext === true &&
    supportsTransferableStreams()
  )
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (registration === null) return null
  if (registration === undefined) {
    if (!('serviceWorker' in navigator)) {
      registration = null
      return null
    }
    try {
      registration = await navigator.serviceWorker.register(`${BASE}dl/sw.js`, {
        scope: `${BASE}dl/`,
      })
    } catch {
      registration = null
      return null
    }
  }
  const reg = registration
  if (reg.active) return reg.active
  const worker = reg.installing ?? reg.waiting
  if (!worker) return reg.active
  await new Promise<void>((resolve) => {
    const check = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', check)
        resolve()
      }
    }
    worker.addEventListener('statechange', check)
    check()
  })
  return reg.active
}

/** Warm up the download worker (call once at startup on non-FSA browsers). */
export function registerDownloadWorker(): void {
  void activeWorker()
}

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Open a streamed download via the /dl/ worker. Returns a sink whose writes
 * stream to disk (backpressured), or null if the worker can't be brought up.
 * Must be called from a user gesture (the Accept click) so the download starts.
 */
export async function createServiceWorkerSink(
  filename: string,
  mimeType: string,
  size: number | null,
): Promise<WritableFileSink | null> {
  const worker = await activeWorker()
  if (!worker) return null

  const name = safeName(filename)
  const id = randomId()
  const stream = new TransformStream<Uint8Array, Uint8Array>()

  worker.postMessage(
    {
      type: 'setu-download',
      id,
      filename: name,
      mime: mimeType,
      size,
      readable: stream.readable,
    },
    [stream.readable as unknown as Transferable],
  )

  const iframe = document.createElement('iframe')
  iframe.hidden = true
  iframe.src = `${BASE}dl/${id}/${encodeURIComponent(name)}`
  document.body.appendChild(iframe)

  const writer = stream.writable.getWriter()
  let done = false
  return {
    async write(chunk: Uint8Array): Promise<void> {
      await writer.ready
      await writer.write(chunk)
    },
    async close(): Promise<void> {
      done = true
      await writer.close()
      setTimeout(() => iframe.remove(), 3000)
    },
    async abort(): Promise<void> {
      if (done) return
      done = true
      try {
        await writer.abort()
      } catch {
        // stream already errored/closed
      }
      iframe.remove()
    },
  }
}
