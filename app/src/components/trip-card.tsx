import { Link } from '@tanstack/react-router'
import { TrainFront } from 'lucide-react'
import { Pill } from '@/components/ui/pill'
import { useI18n } from '@/lib/i18n'
import type { Trip } from '@/lib/store'

/* Trip card (design 1a): train, route, date and one honest status pill.
   Berth numbers are never printed here — only the traveller's own trip screen
   shows them, and other people see "Berth ••" (AGENTS.md 13). */
export function TripCard({ trip }: { trip: Trip }) {
  const { t, status, date } = useI18n()
  const passenger = trip.passengers[0]
  const ticketStatus = passenger?.status ?? 'CNF'
  const route = [trip.from_code, trip.to_code].filter(Boolean).join(' → ')

  let badge = <Pill>{t('home.firstHere')}</Pill>
  if (ticketStatus === 'CAN') {
    badge = <Pill tone="danger">{status('CAN')}</Pill>
  } else if (ticketStatus === 'WL' || ticketStatus === 'RAC') {
    badge = <Pill tone="accent">{status(ticketStatus)}</Pill>
  } else if (trip.open_to_swap) {
    badge = <Pill tone="primary">{t('home.openToSwap')}</Pill>
  }

  return (
    <Link
      to="/trips/$tripId"
      params={{ tripId: trip.id }}
      className="mb-2 flex min-h-16 items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
        <TrainFront aria-hidden className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-head text-section text-ink">
          {trip.train_name || t('train.title', { n: trip.train_no })}
        </b>
        <small className="block truncate text-caption text-muted">
          {[trip.train_no, route].filter(Boolean).join(' · ')}
        </small>
        <small className="block text-caption text-muted">{date(trip.journey_date)}</small>
        <span className="mt-1 inline-flex">{badge}</span>
      </span>
    </Link>
  )
}
