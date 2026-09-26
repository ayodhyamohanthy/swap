import { Link, createFileRoute } from '@tanstack/react-router'
import { BellRing, ChevronRight } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Card, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { updates as listUpdates, type UpdateRow } from '@/lib/requests'
import { useRequestsState } from '@/lib/use-store'

/* Screen 20 "Updates" (design 13a) — in-app list behind the Swaps tab badge
   (docs/08: free web push falls back to this list). */

export const Route = createFileRoute('/updates')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  component: UpdatesScreen,
})

function rowCopy(kind: UpdateRow['kind'], t: ReturnType<typeof useI18n>['t']): string {
  switch (kind) {
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
  }
}

function rowHref(row: UpdateRow): string {
  if (row.kind === 'accepted') return `/pay/${row.request_id}`
  if (row.kind === 'locked') return `/swaps/${row.request_id}/summary`
  if (row.request_id) return `/request/${row.request_id}`
  return row.trip_id ? `/incoming/${row.trip_id}` : '/swaps'
}

function UpdatesScreen() {
  const { t } = useI18n()
  useRequestsState()
  const rows = listUpdates()

  return (
    <div>
      <h1 className="text-title text-ink">{t('updates.title')}</h1>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardTitle>{t('updates.empty')}</CardTitle>
        </Card>
      ) : (
        <section className="mt-4 space-y-2">
          {rows.map((row) => (
            <Link
              key={row.id}
              to={rowHref(row) as '/'}
              className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-card px-3 py-2 shadow-soft"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                <BellRing aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-body text-ink">{rowCopy(row.kind, t)}</span>
              <ChevronRight aria-hidden className="size-5 text-muted" />
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}