import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Small status pill: "Open to swap", "Confirmed", "Waitlisted". */
export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'primary' | 'accent' | 'danger'
  className?: string
}) {
  const tones = {
    neutral: 'border-line bg-background text-muted',
    primary: 'border-primary/30 bg-wash text-primary',
    accent: 'border-accent/40 bg-accent-soft text-ink',
    danger: 'border-danger/30 bg-danger-soft text-danger',
  } as const
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-caption font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
