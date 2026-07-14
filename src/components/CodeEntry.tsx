import { type FormEvent, useState } from 'react'
import { Button } from './ui'

/** Receiver's short-code entry: type the code the sender read out. */
export function CodeEntry({
  onSubmit,
  onBack,
}: {
  onSubmit: (code: string) => void
  onBack: () => void
}) {
  const [value, setValue] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        // biome-ignore lint/a11y/noAutofocus: the code field is the sole action here
        autoFocus
        data-testid="code-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="742-otter-anvil"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="Pairing code"
        className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-center font-mono text-base tracking-tight text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <Button
        type="submit"
        data-testid="code-submit"
        disabled={!value.trim()}
        className="w-full"
      >
        Connect
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Send a file instead
      </button>
    </form>
  )
}
