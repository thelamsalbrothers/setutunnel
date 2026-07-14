import { useState } from 'react'
import { cx } from '../lib/cx'
import { CheckIcon, CopyIcon } from './icons'
import { WaitingRow } from './PairingPanel'

/**
 * Sender's short-code panel: the spoken code (`742-otter-anvil`) shown as a
 * mono slab, plus the "waiting for peer" state. The receiver types it in.
 */
export function CodePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked — the code is still visible to read/type manually
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-xs font-medium text-muted-foreground">
        Read this code to the other person
      </p>

      <div
        data-testid="pairing-code"
        className="w-full select-all rounded-lg border bg-muted/40 px-4 py-6 text-center"
      >
        <span className="font-mono text-[26px] font-semibold tracking-tight text-foreground sm:text-[32px]">
          {code}
        </span>
      </div>

      <button
        type="button"
        onClick={copy}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
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
        {copied ? 'Copied' : 'Copy code'}
      </button>

      <WaitingRow />
    </div>
  )
}
