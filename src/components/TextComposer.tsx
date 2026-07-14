import { useState } from 'react'
import { Button } from './ui'

export function TextComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a link, note, or code to send…"
        rows={5}
        data-testid="text-input"
        className="w-full resize-none rounded-md border border-input bg-transparent p-3 font-mono text-sm text-foreground shadow-xs transition-colors placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <Button
        className="self-end"
        onClick={() => {
          if (trimmed) onSend(trimmed)
        }}
        disabled={trimmed.length === 0}
        data-testid="send-text"
      >
        Share text
      </Button>
    </div>
  )
}
