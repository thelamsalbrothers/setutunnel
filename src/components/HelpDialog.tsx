import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  CloseIcon,
  DownloadIcon,
  GhostIcon,
  ShieldIcon,
  UploadIcon,
} from './icons'

const GITHUB_URL =
  (import.meta.env.VITE_GITHUB_URL as string | undefined) ||
  'https://github.com'

/** A "how it works" modal: accessible (role=dialog, Escape / click-outside /
 *  focus handling), shadcn-styled, portalled to <body>. */
export function HelpDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Move focus into the dialog; lock background scroll while open.
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative z-10 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg focus:outline-none"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              How it works
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Send files or text straight to another device — encrypted
              end-to-end, peer-to-peer. No accounts, no uploads.
            </p>

            <ol className="mt-5 flex flex-col gap-4">
              <Step
                n={1}
                icon={<UploadIcon className="h-4 w-4" />}
                title="Pick what to send"
                body="Drop files (or a whole folder) on the sender, or switch to the Text tab to paste a note."
              />
              <Step
                n={2}
                icon={<DownloadIcon className="h-4 w-4" />}
                title="Connect the two devices"
                body="Scan the QR or open the link on the other device — or choose Short code and read the 3-part code aloud, then type it under “Have a code? Receive”."
              />
              <Step
                n={3}
                icon={<ShieldIcon className="h-4 w-4" />}
                title="Check the safety code, then accept"
                body="Both screens show the same safety code (emoji + number). If they match, accept — and the file streams straight to your device."
              />
            </ol>

            <div className="mt-5 flex flex-col gap-3 border-t pt-4">
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <GhostIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Both devices need to be online at once — it's a live tunnel,
                  not a mailbox. The connection is torn down the moment the
                  transfer ends.
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  No accounts. No cloud. No trace.
                </span>{' '}
                And you don't have to just take our word for it — SetuTunnel is
                fully open source, so you can read exactly what it does.{' '}
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                >
                  See for yourself on GitHub →
                </a>
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <li className="flex gap-3">
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        {icon}
        <span className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {n}
        </span>
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </li>
  )
}
