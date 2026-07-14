import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
}

const VARIANTS: Record<string, string> = {
  primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  ghost:
    'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
  danger:
    'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
}

export function Button({
  variant = 'primary',
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** shadcn-style Card surface. */
export function GlassCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cx(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}
