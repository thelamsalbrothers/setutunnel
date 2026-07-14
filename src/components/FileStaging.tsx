import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { formatBytes } from '../lib/format'
import { CloseIcon, FileIcon, UploadIcon } from './icons'

/**
 * Review step before sending: the picked files shown as square tiles inside a
 * scrollable box, each removable, with an "add more" affordance. Keeps the user
 * in control (prune/add) instead of jumping straight to pairing on first pick.
 */
export function FileStaging({
  files,
  onAdd,
  onRemove,
}: {
  files: File[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const total = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
          {formatBytes(total)}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="add-more"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UploadIcon className="h-3.5 w-3.5" /> Add more
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          data-testid="add-more-input"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? [])
            if (picked.length) onAdd(picked)
            event.target.value = ''
          }}
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${index}`}
              className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-md border bg-card p-2"
            >
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${file.name}`}
                data-testid="remove-file"
                className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                <FileIcon className="h-5 w-5" />
              </div>
              <div className="w-full min-w-0 px-0.5">
                <MarqueeText text={file.name} testId="staged-name" />
                <p className="mt-0.5 text-center text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(file.size)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Gap (px) between the repeated copies — must match the `.marquee-track` gap. */
const MARQUEE_GAP = 32

/**
 * A single line of text that marquee-scrolls one direction, continuously, on
 * hover or tap — but only when it actually overflows (measured), so short names
 * sit still and centered. When overflowing, a second copy trails after a gap so
 * the loop is seamless (a ticker), not a back-and-forth bounce.
 */
function MarqueeText({ text, testId }: { text: string; testId?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  const [overflowing, setOverflowing] = useState(false)
  const [active, setActive] = useState(false)

  const measure = () => {
    const container = containerRef.current
    const textEl = textRef.current
    if (!container || !textEl) return
    const textWidth = textEl.getBoundingClientRect().width
    const over = textWidth > container.clientWidth + 1
    setOverflowing(over)
    // One copy + the gap: scrolling exactly this far lands the trailing copy
    // where the first began, so the animation repeats seamlessly.
    setShift(over ? textWidth + MARQUEE_GAP : 0)
  }
  // Re-measure whenever the name changes (and once on mount, after layout).
  useLayoutEffect(measure, [text])

  return (
    <span
      ref={containerRef}
      title={text}
      onPointerEnter={measure}
      onClick={() => {
        measure()
        setActive((on) => !on)
      }}
      className={cx(
        'marquee text-sm font-medium text-foreground',
        overflowing ? 'text-left' : 'text-center',
        active && 'is-active',
      )}
      style={
        {
          '--marquee-shift': `${shift}px`,
          '--marquee-duration': `${Math.max(4, shift / 40)}s`,
        } as CSSProperties
      }
    >
      <span className="marquee-track">
        <span ref={textRef} data-testid={testId}>
          {text}
        </span>
        {overflowing && <span aria-hidden="true">{text}</span>}
      </span>
    </span>
  )
}
