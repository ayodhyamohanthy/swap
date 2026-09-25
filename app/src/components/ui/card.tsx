import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-line bg-card p-4 shadow-soft', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-section text-ink', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-body text-muted', className)} {...props} />
}

export function CardRow({
  className,
  icon,
  title,
  detail,
  action,
}: {
  className?: string
  icon?: ReactNode
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {icon ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-wash text-primary">
          {icon}
        </span>
      ) : null}
      <span className="flex-1">
        <b className="block font-head text-body text-ink">{title}</b>
        {detail ? <span className="block text-caption text-muted">{detail}</span> : null}
      </span>
      {action}
    </div>
  )
}
