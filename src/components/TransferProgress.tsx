import { motion } from 'motion/react'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'

export function TransferProgress({
  label,
  bytes,
  total,
  speed,
  done,
}: {
  label: string
  bytes: number
  total: number
  speed: number
  done: boolean
}) {
  const pct = total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0
  const eta = speed > 0 && !done ? (total - bytes) / speed : 0

  return (
    <div className="flex flex-col gap-3" data-testid="progress">
      <div className="flex items-end justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-2xl font-semibold text-foreground tabular-nums">
          {done ? 100 : pct}
          <span className="text-base text-muted-foreground">%</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${done ? 100 : pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
        <span>
          {formatBytes(bytes)} / {formatBytes(total)}
        </span>
        {!done && (
          <span>
            {formatSpeed(speed)} · {formatEta(eta)} left
          </span>
        )}
      </div>
    </div>
  )
}
