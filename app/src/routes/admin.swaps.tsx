import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { downloadCsv, swapsToCsv, type AdminSwapRow } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { useRequestsState } from '@/lib/use-store'
import { getTrip } from '@/lib/store'

/* Admin A4 "Swaps" (design 17). Shows requester PNR last4 only — never the full
   PNR (rule 13). Status mirrors docs/03 so staff read the same words the app does. */

export const Route = createFileRoute('/admin/swaps')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminSwaps,
})

function AdminSwaps() {
  const { t, date } = useI18n()
  const { requests } = useRequestsState()

  const rows: AdminSwapRow[] = requests.map((request) => {
    const trip = getTrip(request.trip_id)
    return {
      id: request.id,
      requester_last4: trip?.pnr_last4 ?? '••••',
      train_no: trip?.train_no ?? '—',
      journey_date: trip?.journey_date ?? '',
      status: request.status,
      updated_at: request.updated_at.slice(0, 10),
    }
  })

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.swaps')}</h1>

      <Button
        className="mt-4"
        size="sm"
        onClick={() => downloadCsv('seatswap-swaps.csv', swapsToCsv(rows))}
      >
        {t('admin.csv')}
      </Button>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-3"
            >
              <span className="min-w-0">
                <b className="block truncate font-head text-body text-ink">
                  {row.train_no} · PNR ••{row.requester_last4}
                </b>
                <small className="block text-caption text-muted">{date(row.journey_date)}</small>
              </span>
              <Pill tone={row.status === 'locked' ? 'primary' : 'neutral'}>{row.status}</Pill>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
