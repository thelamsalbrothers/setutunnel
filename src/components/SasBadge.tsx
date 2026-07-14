import type { Sas } from '../crypto/sas'
import { cx } from '../lib/cx'
import { ShieldIcon } from './icons'

/** The Short Authentication String — should match on both devices (§4.3). */
export function SasBadge({ sas, className }: { sas: Sas; className?: string }) {
  return (
    <div className={cx('rounded-lg border bg-muted/40 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldIcon className="h-3.5 w-3.5" />
          Safety code
        </span>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {sas.number}
        </span>
      </div>
      <div
        className="mt-2.5 flex justify-center gap-2.5 text-3xl select-none sm:text-[34px]"
        data-testid="sas"
      >
        {sas.emoji.map((emoji, index) => (
          <span key={`${emoji}-${index}`}>{emoji}</span>
        ))}
      </div>
      <p className="mt-2.5 text-center text-xs text-muted-foreground">
        These should match on both devices
      </p>
    </div>
  )
}
