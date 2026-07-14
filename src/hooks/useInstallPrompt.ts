import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Captures the browser's deferred `beforeinstallprompt` so the app can offer an
 * explicit "Install" button (Chromium). `canInstall` is false where install
 * isn't offered (already installed, iOS, unsupported).
 */
export function useInstallPrompt(): {
  canInstall: boolean
  install: () => void
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = () => {
    if (!deferred) return
    void deferred.prompt()
    void deferred.userChoice.finally(() => setDeferred(null))
  }

  return { canInstall: deferred !== null, install }
}
