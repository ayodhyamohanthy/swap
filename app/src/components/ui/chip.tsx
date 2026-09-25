import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** A choice chip (class, berth type, status, quota). 48px tall on phones. */
export function Chip({
  className,
  selected = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'tap shrink-0 rounded-full border px-3.5 text-body font-semibold transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-ink'
          : 'border-line bg-card text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function ChipRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('chip-row no-scrollbar', className)} {...props} />
}
