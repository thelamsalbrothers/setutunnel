import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { UploadIcon } from './icons'

export function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // `webkitdirectory` isn't in the React input types; set it on the element.
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const pickFiles = () => inputRef.current?.click()
  const pickFolder = () => folderRef.current?.click()

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) onFiles(files)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose files to send"
        onClick={pickFiles}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            pickFiles()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          take(event.dataTransfer.files)
        }}
        className={cx(
          'group flex cursor-pointer flex-col items-center justify-center gap-3.5 rounded-lg border border-dashed px-6 py-11 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          over
            ? 'border-primary/60 bg-accent'
            : 'border-border bg-muted/40 hover:bg-accent',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="file-input"
          onChange={(event) => take(event.target.files)}
        />
        <div className="grid h-11 w-11 place-items-center rounded-md border bg-background text-muted-foreground shadow-xs transition-colors group-hover:text-foreground">
          <UploadIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Drop files here, or click to browse
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Streamed straight to the other device — never a server.
          </p>
        </div>
      </div>

      <input
        ref={folderRef}
        type="file"
        className="hidden"
        data-testid="folder-input"
        onChange={(event) => take(event.target.files)}
      />
      <button
        type="button"
        onClick={pickFolder}
        data-testid="pick-folder"
        className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        or send a whole folder →
      </button>
    </div>
  )
}
