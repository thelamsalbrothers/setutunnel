import { useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'
import { Button } from './ui'

/** Shows a received text snippet inline with a copy button. */
export function TextResult({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked — the text is still selectable to copy manually
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <pre
        data-testid="received-text"
        className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 text-left font-mono text-sm wrap-break-words whitespace-pre-wrap text-foreground"
      >
        {text}
      </pre>
      <Button variant="ghost" className="self-center" onClick={copy}>
        {copied ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <CopyIcon className="h-4 w-4" />
        )}
        {copied ? 'Copied' : 'Copy text'}
      </Button>
    </div>
  )
}
