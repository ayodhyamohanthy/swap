import { TrainFront, Ticket, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* The Swap summary ticket stub (design 9c). The design draws it as a physical
   ticket — a dark green header, a perforated tear, and a stub below — because
   it is the one artefact a passenger keeps after the swap. It also has to work
   with no network, so nothing here fetches; the values arrive as props from
   the on-device store.

   The tear is two background-coloured circles sitting on a dashed rule: no SVG,
   no extra assets, and it stays sharp at any card width. */

export function TicketCard({
  brand,
  tagline,
  title,
  headline,
  subline,
  offlineLabel,
  stubIcon,
  stubTitle,
  stubBody,
  children,
}: {
  brand: string
  tagline: string
  title: string
  headline: ReactNode
  subline?: ReactNode
  offlineLabel: string
  stubIcon?: ReactNode
  stubTitle: string
  stubBody: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-soft">
      <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-ink">
        <TrainFront aria-hidden className="size-8 shrink-0" />
        <span className="min-w-0">
          <b className="block font-head text-section leading-tight">{brand}</b>
          <span className="block text-caption text-primary-ink/85">{tagline}</span>
        </span>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-center font-head text-title font-bold text-ink">{title}</h1>
        <div className="mt-3 border-t border-line" />
        <p className="mt-3 text-center font-head text-body font-bold text-ink">{headline}</p>
        {subline ? <p className="mt-1 text-center text-body text-muted">{subline}</p> : null}
        <p className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-wash px-3 py-1.5 text-caption font-semibold text-muted">
            <WifiOff aria-hidden className="size-4" />
            {offlineLabel}
          </span>
        </p>
        {children}
      </div>

      {/* Perforation: a dashed rule with a notch bitten out of each side. */}
      <div className="relative my-4 h-0" aria-hidden>
        <div className="absolute inset-x-0 top-0 border-t-2 border-dashed border-line" />
        <span
          className={cn(
            'absolute -top-2 left-0 size-4 -translate-x-1/2 rounded-full bg-background',
          )}
        />
        <span className="absolute -top-2 right-0 size-4 translate-x-1/2 rounded-full bg-background" />
      </div>

      <div className="flex items-start gap-3 px-4 pb-4">
        {stubIcon ?? <Ticket aria-hidden className="size-6 shrink-0 text-accent" />}
        <span className="min-w-0">
          <b className="block font-head text-body text-ink">{stubTitle}</b>
          <span className="block text-caption text-muted">{stubBody}</span>
        </span>
      </div>
    </div>
  )
}
