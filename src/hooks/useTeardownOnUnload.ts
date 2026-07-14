import { useEffect } from 'react'
import type { TransferController } from '../lib/transfer'

/**
 * Graceful teardown (§6B). On tab close / navigation, release the peer
 * connection, abort any in-flight streamed file, and zeroize key material (via
 * `controller.dispose()`). We listen for `pagehide` — which fires on close,
 * navigation, and bfcache entry — plus `beforeunload` as a backup.
 *
 * We deliberately do NOT dispose on React unmount: in dev, StrictMode
 * mounts→unmounts→remounts, and disposing on that cleanup would tear down a live
 * transfer. Real unload is the only signal we act on here.
 */
export function useTeardownOnUnload(controller: TransferController): void {
  useEffect(() => {
    const dispose = () => controller.dispose()
    window.addEventListener('pagehide', dispose)
    window.addEventListener('beforeunload', dispose)
    return () => {
      window.removeEventListener('pagehide', dispose)
      window.removeEventListener('beforeunload', dispose)
    }
  }, [controller])
}
