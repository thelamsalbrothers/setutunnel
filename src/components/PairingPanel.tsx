import { useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import { qrDataUrl } from '../lib/qr'
import { CheckIcon, CopyIcon, LinkIcon } from './icons'

/** Shows the QR + shareable link and the "waiting for peer" state (sender). */
export function PairingPanel({ link }: { link: string }) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    qrDataUrl(link)
      .then((url) => {
        if (alive) setQr(url)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [link])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked — the link is still visible to copy manually
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="rounded-lg border bg-white p-3">
        {qr ? (
          <img
            src={qr}
            alt="Scan to receive the file"
            width={192}
            height={192}
            className="h-44 w-44 sm:h-48 sm:w-48"
          />
        ) : (
          <div className="h-44 w-44 animate-pulse rounded bg-muted sm:h-48 sm:w-48" />
        )}
      </div>

      <div className="flex w-full items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3">
        <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span
          data-testid="pairing-link"
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {link}
        </span>
        <button
          type="button"
          onClick={copy}
          className={cx(
            'inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
            copied
              ? 'text-success'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <WaitingRow />
    </div>
  )
}

/** The shared "waiting for the other device" indicator. */
export function WaitingRow() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="relative flex h-2 w-2" data-motion>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      Waiting for the other device…
    </div>
  )
}
