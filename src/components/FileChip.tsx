import { formatBytes } from '../lib/format'
import type { FileInfo } from '../lib/transfer'
import { FileIcon } from './icons'

export function FileChip({ file }: { file: FileInfo }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-2.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <FileIcon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p
          className="truncate text-sm font-medium text-foreground"
          data-testid="file-name"
        >
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatBytes(file.size)}
          {file.type ? ` · ${file.type}` : ''}
        </p>
      </div>
    </div>
  )
}
