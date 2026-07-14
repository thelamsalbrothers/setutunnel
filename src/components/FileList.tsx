import { formatBytes } from '../lib/format'
import type { FileInfo } from '../lib/transfer'
import { FileChip } from './FileChip'

/** A list of files (name + size), with a count/total summary when there's more
 *  than one. Scrolls when there are many. */
export function FileList({ files }: { files: FileInfo[] }) {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  return (
    <div className="flex flex-col gap-2">
      {files.length > 1 && (
        <div className="flex items-center justify-between px-0.5 text-xs">
          <span
            className="font-medium text-muted-foreground"
            data-testid="file-count"
          >
            {files.length} files
          </span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {formatBytes(total)}
          </span>
        </div>
      )}
      <div className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-0.5">
        {files.map((file, index) => (
          <FileChip key={`${file.name}-${index}`} file={file} />
        ))}
      </div>
    </div>
  )
}
