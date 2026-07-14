/**
 * SetuTunnel streamed-download service worker (CLAUDE.md §6E, tier 2).
 *
 * Lives at /dl/sw.js, so its scope is /dl/ — it only intercepts navigations to
 * /dl/<id> and never touches the app's Workbox SW at the root scope. The page
 * transfers a ReadableStream here (transferable streams) and navigates a hidden
 * iframe to /dl/<id>; this worker answers that navigation with a streaming
 * attachment fed by that stream, so the browser's native downloader writes the
 * file to disk incrementally. That gives flat-memory large receives on browsers
 * without the File System Access API (Firefox, Safari). Backpressure flows back
 * through the transferred stream, so RAM stays bounded.
 */

const pending = new Map() // id -> entry { readable, filename, mime, size } | { resolve }

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'setu-download' || !data.id) return
  const waiting = pending.get(data.id)
  pending.set(data.id, data)
  if (waiting && typeof waiting.resolve === 'function') waiting.resolve(data)
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith('/dl/')) return
  const id = url.pathname.slice(4).split('/')[0]
  if (!id || id === 'sw.js') return
  event.respondWith(respond(id))
})

async function respond(id) {
  let entry = pending.get(id)
  if (!entry || !entry.readable) {
    // The navigation beat the message; wait briefly for the stream to arrive.
    entry = await new Promise((resolve) => {
      pending.set(id, { resolve })
      setTimeout(() => resolve(null), 8000)
    })
  }
  pending.delete(id)
  if (!entry || !entry.readable) {
    return new Response('download expired', { status: 404 })
  }

  const headers = new Headers({
    'content-type': entry.mime || 'application/octet-stream',
    'content-disposition': disposition(entry.filename),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (entry.size != null) headers.set('content-length', String(entry.size))
  return new Response(entry.readable, { headers })
}

/** Build a safe Content-Disposition. `name` is already control-char-free. */
function disposition(name) {
  const fallback = asciiFallback(name) || 'download'
  return (
    'attachment; filename="' +
    fallback +
    "\"; filename*=UTF-8''" +
    encodeURIComponent(name || 'download')
  )
}

function asciiFallback(name) {
  let out = ''
  for (const ch of String(name || '')) {
    const code = ch.codePointAt(0)
    out += code >= 32 && code < 127 && ch !== '"' && ch !== ';' ? ch : '_'
  }
  return out
}
