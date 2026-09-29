import { Link, createFileRoute } from '@tanstack/react-router'
import { BellRing, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { RouteChrome } from '@/components/app-shell'
import { Card, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import {
  markAllUpdatesRead,
  markUpdateRead,
  updates as listUpdates,
  type UpdateRow,
} from '@/lib/requests'
import { getTrip } from '@/lib/store'
import { useUnreadUpdates } from '@/lib/use-store'

/* Screen 20 "Updates" (design 13a) — in-app list behind the Swaps tab badge
   (docs/08: free web push falls back to this list). */

export const Route = createFileRoute('/updates')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  component: UpdatesScreen,
})

function rowCopy(row: UpdateRow, t: ReturnType<typeof useI18n>['t']): string {
  const amount = Math.round((row.amount_paise ?? 0) / 100)
  switch (row.kind) {
    case 'accepted':
      return t('manage.acceptedCta')
    case 'faster':
      return t('incoming.faster')
    case 'locked':
      return t('summary.title')
    case 'incoming_waiting':
      return t('incoming.accepted')
    case 'incoming_declined':
      return t('incoming.declined')
    case 'incoming_faster':
      return t('incoming.faster')
    case 'chart_out': {
      const trip = row.trip_id ? getTrip(row.trip_id) : undefined
      return t('updates.chartOut', { train: trip?.train_no ?? '' })
    }
    case 'waitlist_chart': {
      const trip = row.trip_id ? getTrip(row.trip_id) : undefined
      return t('updates.waitlistChart', { train: trip?.train_no ?? '' })
    }
    case 'credit_added':
      return t('updates.creditAdded', { amount })
    case 'credit_expiring':
      return t('updates.creditExpiring', { amount, days: row.days_left ?? 30 })
    case 'request_expired':
      return t('updates.requestExpired')
  }
}

const ROW_CLASSES =
  'flex min-h-14 items-center gap-3 rounded-card border border-line bg-card px-3 py-2 shadow-soft'

const ROW_UNREAD_CLASSES =
  'flex min-h-14 items-center gap-3 rounded-card border-2 border-primary bg-card px-3 py-2 shadow-soft'

function RowShell({ children, unread }: { children: ReactNode; unread: boolean }) {
  return (
    <>
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
        <BellRing aria-hidden className="size-5" />
        {unread ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 text-body text-ink">{children}</span>
      <ChevronRight aria-hidden className="size-5 text-muted" />
    </>
  )
}

/** Every destination is a typed route — a renamed route fails the build here.
    Opening a row marks it read. */
function UpdateLink({ row, copy, read }: { row: UpdateRow; copy: string; read: boolean }) {
  const classes = read ? ROW_CLASSES : ROW_UNREAD_CLASSES
  const open = () => markUpdateRead(row.id)
  switch (row.kind) {
    case 'accepted':
      return row.request_id ? (
        <Link to="/pay/$requestId" params={{ requestId: row.request_id }} className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      ) : null
    case 'locked':
      return row.request_id ? (
        <Link to="/swaps/$id/summary" params={{ id: row.request_id }} className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      ) : null
    case 'chart_out':
    case 'waitlist_chart':
      return row.trip_id ? (
        <Link to="/trips/$tripId" params={{ tripId: row.trip_id }} className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      ) : null
    case 'credit_added':
    case 'credit_expiring':
      return (
        <Link to="/profile" className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      )
    case 'faster':
    case 'request_expired':
      return row.request_id ? (
        <Link to="/request/$id" params={{ id: row.request_id }} className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      ) : null
    case 'incoming_waiting':
    case 'incoming_declined':
    case 'incoming_faster':
      return row.trip_id ? (
        <Link to="/incoming/$id" params={{ id: row.trip_id }} className={classes} onClick={open}>
          <RowShell unread={!read}>{copy}</RowShell>
        </Link>
      ) : null
  }
}

function UpdatesScreen() {
  const { t } = useI18n()
  const unread = useUnreadUpdates()
  const rows = listUpdates()
  const unreadIds = new Set(unread.map((row) => row.id))

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title text-ink">{t('updates.title')}</h1>
        {unread.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => markAllUpdatesRead()}>
            {t('updates.markRead')}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardTitle>{t('updates.empty')}</CardTitle>
        </Card>
      ) : (
        <section className="mt-4 space-y-2">
          {rows.map((row) => (
            <UpdateLink key={row.id} row={row} copy={rowCopy(row, t)} read={!unreadIds.has(row.id)} />
          ))}
        </section>
      )}
    </div>
  )
}