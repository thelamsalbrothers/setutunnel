import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AuroraBackground } from './components/AuroraBackground'
import { BrandMark } from './components/BrandMark'
import { CodeEntry } from './components/CodeEntry'
import { CodePanel } from './components/CodePanel'
import { ConsentCard } from './components/ConsentCard'
import { DropZone } from './components/DropZone'
import { FileList } from './components/FileList'
import { FileStaging } from './components/FileStaging'
import { HelpDialog } from './components/HelpDialog'
import {
  BoltIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  GhostIcon,
  HelpIcon,
  InstallIcon,
  ShieldIcon,
  SpinnerIcon,
} from './components/icons'
import { PairingPanel } from './components/PairingPanel'
import { SasBadge } from './components/SasBadge'
import { TextComposer } from './components/TextComposer'
import { TextResult } from './components/TextResult'
import { ThemeToggle } from './components/ThemeToggle'
import { TransferProgress } from './components/TransferProgress'
import { Button, GlassCard } from './components/ui'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { useTeardownOnUnload } from './hooks/useTeardownOnUnload'
import { useTransferSnapshot } from './hooks/useTransfer'
import { cx } from './lib/cx'
import {
  type FileInfo,
  type PairingMode,
  type Phase,
  TransferController,
  type TransferSnapshot,
  tryParsePairing,
} from './lib/transfer'
import type { Pairing } from './protocol/pairing'

export default function App() {
  const [pairing] = useState<Pairing | null>(() => tryParsePairing())
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-full flex-col">
        <AuroraBackground />
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <BrandMark />
          <div className="flex items-center gap-2">
            <InstallButton />
            <HelpButton onClick={() => setHelpOpen(true)} />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-12 sm:px-6">
          {pairing ? <ReceiveFlow pairing={pairing} /> : <Home />}
        </main>

        <Footer />
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </MotionConfig>
  )
}

function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="help"
      aria-label="How it works"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-transparent text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <HelpIcon className="h-4.5 w-4.5" />
    </button>
  )
}

function InstallButton() {
  const { canInstall, install } = useInstallPrompt()
  if (!canInstall) return null
  return (
    <button
      type="button"
      onClick={install}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <InstallIcon className="h-4 w-4" />
      Install
    </button>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-1.5 px-5 py-7 text-xs font-medium text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <ShieldIcon className="h-3.5 w-3.5" /> End-to-end encrypted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <BoltIcon className="h-3.5 w-3.5" /> Direct peer-to-peer
      </span>
      <span className="inline-flex items-center gap-1.5">
        <GhostIcon className="h-3.5 w-3.5" /> Zero trace
      </span>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

function Home() {
  const [surface, setSurface] = useState<'send' | 'receive'>('send')
  return surface === 'send' ? (
    <SendFlow onReceiveByCode={() => setSurface('receive')} />
  ) : (
    <ReceiveByCodeFlow onBack={() => setSurface('send')} />
  )
}

function SendFlow({ onReceiveByCode }: { onReceiveByCode: () => void }) {
  const [controller] = useState(() => new TransferController('sender'))
  const snap = useTransferSnapshot(controller)
  useTeardownOnUnload(controller)
  useDocumentTitle(phaseTitle('sender', snap.phase))
  const [mode, setMode] = useState<'files' | 'text'>('files')
  const [pairing, setPairing] = useState<PairingMode>('link')
  const [files, setFiles] = useState<File[]>([])

  const addFiles = (picked: File[]) =>
    setFiles((prev) => {
      const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`
      const seen = new Set(prev.map(key))
      return [...prev, ...picked.filter((f) => !seen.has(key(f)))]
    })
  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index))

  return (
    <Stage snap={snap} title={senderTitle(snap.phase, snap.pairingMode)}>
      {snap.phase === 'idle' && (
        <div className="flex flex-col gap-5">
          <ModeTabs mode={mode} onChange={setMode} />
          {mode === 'files' ? (
            files.length === 0 ? (
              <DropZone onFiles={addFiles} />
            ) : (
              <FileStaging
                files={files}
                onAdd={addFiles}
                onRemove={removeFile}
              />
            )
          ) : (
            <TextComposer
              onSend={(text) => void controller.startSendText(text, pairing)}
            />
          )}
          <PairingModeTabs mode={pairing} onChange={setPairing} />
          {mode === 'files' && files.length > 0 && (
            <Button
              className="w-full"
              data-testid="send-files"
              onClick={() => void controller.startSend(files, pairing)}
            >
              Send {files.length} file{files.length === 1 ? '' : 's'} →
            </Button>
          )}
          {mode === 'files' && files.length === 0 && <FeatureRow />}
          <button
            type="button"
            onClick={onReceiveByCode}
            data-testid="go-receive"
            className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Have a code? Receive a file →
          </button>
        </div>
      )}

      {(snap.phase === 'creating' || snap.phase === 'waiting') &&
        (snap.link || snap.code ? (
          <div className="flex flex-col gap-5">
            {snap.files.length > 0 && <FileList files={snap.files} />}
            {snap.pairingMode === 'code' && snap.code ? (
              <CodePanel code={snap.code} />
            ) : (
              snap.link && <PairingPanel link={snap.link} />
            )}
            <CancelButton />
          </div>
        ) : (
          <Spinner label="Opening a tunnel…" />
        ))}

      {snap.phase === 'consent' && (
        <div className="flex flex-col gap-5">
          {snap.files.length > 0 && <FileList files={snap.files} />}
          {snap.sas && <SasBadge sas={snap.sas} />}
          {snap.pairingMode === 'code' && <SasCompareHint />}
          <Spinner label="Connected — waiting for them to accept…" />
        </div>
      )}

      {snap.phase === 'transferring' && (
        <div className="flex flex-col gap-5">
          {snap.files.length > 0 && <FileList files={snap.files} />}
          <TransferProgress
            label={progressLabel('Sending', snap)}
            bytes={snap.bytes}
            total={snap.total}
            speed={snap.speed}
            done={false}
          />
          <CancelButton />
        </div>
      )}

      {snap.phase === 'complete' && (
        <Outcome
          tone="success"
          icon={<CheckIcon className="h-8 w-8" />}
          title="Sent!"
          detail={
            snap.kind === 'text'
              ? 'Your text was delivered.'
              : outcomeDetail(snap.files, 'arrived safely')
          }
        />
      )}
      {snap.phase === 'declined' && (
        <Outcome
          tone="muted"
          icon={<CloseIcon className="h-8 w-8" />}
          title="Declined"
          detail="The other device turned down the file."
        />
      )}
      {snap.phase === 'error' && <ErrorOutcome message={snap.error} />}
    </Stage>
  )
}

function senderTitle(phase: Phase, pairing: PairingMode): StageTitle {
  switch (phase) {
    case 'idle':
      return {
        title: 'Send a file, privately',
        sub: 'No accounts. No cloud. No trace.',
      }
    case 'creating':
    case 'waiting':
      return pairing === 'code'
        ? {
            title: 'Share your code',
            sub: 'Read it to the other person to open the tunnel.',
          }
        : {
            title: 'Scan or share the link',
            sub: 'Open it on the other device to start the tunnel.',
          }
    case 'consent':
      return {
        title: 'Almost there',
        sub: 'Check the safety code matches on both screens.',
      }
    case 'transferring':
      return {
        title: 'Streaming over your tunnel',
        sub: 'Encrypted, straight to the other device.',
      }
    default:
      return { title: 'SetuTunnel', sub: '' }
  }
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

function ReceiveFlow({ pairing }: { pairing: Pairing }) {
  const [controller] = useState(() => new TransferController('receiver'))
  const snap = useTransferSnapshot(controller)
  useTeardownOnUnload(controller)
  useDocumentTitle(phaseTitle('receiver', snap.phase))
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void controller.startReceive(pairing)
  }, [controller, pairing])

  return (
    <Stage snap={snap} title={receiverTitle(snap.phase)}>
      <ReceiveStages controller={controller} snap={snap} />
    </Stage>
  )
}

function ReceiveByCodeFlow({ onBack }: { onBack: () => void }) {
  const [controller] = useState(() => new TransferController('receiver'))
  const snap = useTransferSnapshot(controller)
  useTeardownOnUnload(controller)
  useDocumentTitle(phaseTitle('receiver', snap.phase))

  return (
    <Stage snap={snap} title={receiverTitle(snap.phase)}>
      {snap.phase === 'idle' ? (
        <CodeEntry
          onSubmit={(code) => void controller.startReceiveWithCode(code)}
          onBack={onBack}
        />
      ) : (
        <ReceiveStages controller={controller} snap={snap} />
      )}
    </Stage>
  )
}

function ReceiveStages({
  controller,
  snap,
}: {
  controller: TransferController
  snap: TransferSnapshot
}) {
  return (
    <>
      {snap.phase === 'connecting' && <Spinner label="Connecting securely…" />}

      {snap.phase === 'consent' && snap.files.length > 0 && (
        <div className="flex flex-col gap-5">
          {snap.sas && <SasBadge sas={snap.sas} />}
          {snap.pairingMode === 'code' && <SasCompareHint />}
          <ConsentCard
            files={snap.files}
            danger={snap.danger}
            onAccept={() => controller.accept()}
            onDecline={() => controller.decline()}
          />
        </div>
      )}

      {snap.phase === 'transferring' && (
        <div className="flex flex-col gap-5">
          {snap.files.length > 0 && <FileList files={snap.files} />}
          <TransferProgress
            label={progressLabel('Receiving', snap)}
            bytes={snap.bytes}
            total={snap.total}
            speed={snap.speed}
            done={false}
          />
          <CancelButton />
        </div>
      )}

      {snap.phase === 'complete' &&
        (snap.kind === 'text' && snap.text !== null ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-center text-xl font-semibold tracking-tight text-foreground">
              You received text
            </h2>
            <TextResult text={snap.text} />
            <Button variant="ghost" className="self-center" onClick={goHome}>
              Done
            </Button>
          </div>
        ) : (
          <Outcome
            tone="success"
            icon={<DownloadIcon className="h-8 w-8" />}
            title="Downloaded!"
            detail={
              snap.files.length > 1
                ? `${snap.files.length} files saved as a zip.`
                : outcomeDetail(snap.files, 'saved to your device')
            }
          />
        ))}
      {snap.phase === 'declined' && (
        <Outcome
          tone="muted"
          icon={<CloseIcon className="h-8 w-8" />}
          title="Declined"
          detail="You turned down the file."
        />
      )}
      {snap.phase === 'error' && <ErrorOutcome message={snap.error} />}
    </>
  )
}

function receiverTitle(phase: Phase): StageTitle {
  switch (phase) {
    case 'idle':
      return {
        title: 'Receive with a code',
        sub: 'Type the code the sender read to you.',
      }
    case 'connecting':
      return {
        title: 'Incoming tunnel',
        sub: 'Setting up a private, encrypted link…',
      }
    case 'consent':
      return {
        title: 'Someone wants to send you a file',
        sub: 'Review it, then accept to download.',
      }
    case 'transferring':
      return {
        title: 'Receiving',
        sub: 'Decrypting straight onto your device.',
      }
    default:
      return { title: 'SetuTunnel', sub: '' }
  }
}

// ---------------------------------------------------------------------------
// Shared presentation
// ---------------------------------------------------------------------------

interface StageTitle {
  title: string
  sub: string
}

/** Short tab title reflecting the live state (see useDocumentTitle). */
function phaseTitle(role: 'sender' | 'receiver', phase: Phase): string | null {
  switch (phase) {
    case 'idle':
      return null
    case 'creating':
    case 'waiting':
      return 'Waiting to connect'
    case 'connecting':
      return 'Connecting'
    case 'consent':
      return role === 'sender' ? 'Waiting to accept' : 'Review files'
    case 'transferring':
      return role === 'sender' ? 'Sending…' : 'Receiving…'
    case 'complete':
      return role === 'sender' ? 'Sent' : 'Received'
    case 'declined':
      return 'Declined'
    case 'error':
      return 'Error'
  }
}

const TERMINAL: Phase[] = ['complete', 'declined', 'error']

function Stage({
  snap,
  title,
  children,
}: {
  snap: TransferSnapshot
  title: StageTitle
  children: ReactNode
}) {
  const showHeader = !TERMINAL.includes(snap.phase)
  return (
    <GlassCard className="p-6 sm:p-8">
      <span data-testid="phase" className="sr-only">
        {snap.phase}
      </span>
      {showHeader && (
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[26px]">
            {title.title}
          </h1>
          {title.sub && (
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
              {title.sub}
            </p>
          )}
        </div>
      )}
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div
            key={sectionKey(snap.phase)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}

function sectionKey(phase: Phase): string {
  if (phase === 'creating' || phase === 'waiting') return 'pairing'
  return phase
}

function progressLabel(verb: string, snap: TransferSnapshot): string {
  if (snap.files.length > 1) {
    const n = Math.min(snap.currentIndex + 1, snap.files.length)
    return `${verb} file ${n} of ${snap.files.length}`
  }
  return verb
}

function outcomeDetail(files: FileInfo[], suffix: string): string {
  if (files.length > 1) return `${files.length} files ${suffix}.`
  return `${files[0]?.name ?? 'Your file'} ${suffix}.`
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: 'files' | 'text'
  onChange: (mode: 'files' | 'text') => void
}) {
  return (
    <div className={SEGMENT_TRACK}>
      {(['files', 'text'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          data-testid={`mode-${value}`}
          className={cx(SEGMENT_BTN, mode === value ? SEGMENT_ON : SEGMENT_OFF)}
        >
          {value === 'files' ? 'Files' : 'Text'}
        </button>
      ))}
    </div>
  )
}

/** Shared segmented-control (shadcn Tabs) styling for the two toggles. */
const SEGMENT_TRACK =
  'inline-flex h-9 w-full items-center gap-1 rounded-lg bg-muted p-1'
const SEGMENT_BTN =
  'inline-flex flex-1 items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const SEGMENT_ON = 'bg-background text-foreground shadow-xs'
const SEGMENT_OFF = 'text-muted-foreground hover:text-foreground'

function PairingModeTabs({
  mode,
  onChange,
}: {
  mode: PairingMode
  onChange: (mode: PairingMode) => void
}) {
  const options: [PairingMode, string][] = [
    ['link', 'Link / QR'],
    ['code', 'Short code'],
  ]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs font-medium text-muted-foreground">
        How should they connect?
      </p>
      <div className={SEGMENT_TRACK}>
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            data-testid={`pairmode-${value}`}
            className={cx(
              SEGMENT_BTN,
              mode === value ? SEGMENT_ON : SEGMENT_OFF,
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SasCompareHint() {
  return (
    <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-center text-xs font-medium text-amber-700 dark:text-amber-300/90">
      Say this safety code aloud — it must match on both screens. If it doesn't,
      someone may be intercepting.
    </p>
  )
}

function FeatureRow() {
  const items = [
    { icon: <ShieldIcon className="h-4 w-4" />, label: 'E2E encrypted' },
    { icon: <BoltIcon className="h-4 w-4" />, label: 'Peer-to-peer' },
    { icon: <GhostIcon className="h-4 w-4" />, label: 'Zero trace' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-3 text-center"
        >
          <span className="text-muted-foreground">{item.icon}</span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <SpinnerIcon className="h-7 w-7 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function Outcome({
  tone,
  icon,
  title,
  detail,
}: {
  tone: 'success' | 'muted'
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-5 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className={cx(
          'grid h-14 w-14 place-items-center rounded-full border',
          tone === 'success'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </motion.div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" onClick={goHome}>
        Send another file
      </Button>
    </div>
  )
}

function ErrorOutcome({ message }: { message: string | null }) {
  return (
    <div className="flex flex-col items-center gap-4 py-5 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <CloseIcon className="h-7 w-7" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Something interrupted the tunnel
        </h2>
        <p
          className="mt-1.5 max-w-xs text-sm text-muted-foreground"
          data-testid="error-message"
        >
          {message ?? 'The connection dropped before the transfer finished.'}
        </p>
      </div>
      <Button variant="ghost" onClick={goHome}>
        Try again
      </Button>
    </div>
  )
}

function goHome() {
  window.location.href = window.location.origin
}

function CancelButton() {
  return (
    <button
      type="button"
      onClick={goHome}
      className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Cancel
    </button>
  )
}
