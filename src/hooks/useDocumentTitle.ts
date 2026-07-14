import { useEffect } from 'react'

const BASE = 'SetuTunnel'

/**
 * Reflect the current transfer state in the document title, so the browser tab
 * (and screen readers, on navigation) announce progress — e.g. "Receiving… ·
 * SetuTunnel". Restores the previous title on unmount.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
      ? `${title} · ${BASE}`
      : `${BASE} — private P2P file transfer`
    return () => {
      document.title = previous
    }
  }, [title])
}
