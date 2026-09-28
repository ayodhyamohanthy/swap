import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Coins } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { buildOverview } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState, useRequestsState } from '@/lib/use-store'

/* Admin A1 "Overview" (design 23). Today at a glance, straight from this
   device's activity_log until the backend is wired. Money stays in paise.

   Design 23's six tiles are PNRs added / Requests sent / Accepted / Swaps done /
   Money in / Credit given; "Payments today" and "Credit in circulation" are
   kept alongside them because a count and a rupee total answer different
   questions. */

export const Route = createFileRoute('/admin/_index')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminOverview,
})

function AdminOverview() {
  const { t } = useI18n()
  const { activity, wallet, payments, trips } = useAppState()
  const { requests } = useRequestsState()
  const stats = buildOverview({
    activity,
    walletTotalPaise: wallet.reduce((n, row) => n + row.amount_paise, 0),
    payments,
    requests,
    trips,
  })

  const tiles: Array<[string, string | number]> = [
    [t('admin.s_pnrs'), stats.pnrsToday],
    [t('admin.s_requests'), stats.requestsToday],
    [t('admin.s_accepted'), stats.acceptedToday],
    [t('admin.s_paid'), stats.paidToday],
    [t('admin.s_swaps_done'), stats.swapsDoneToday],
    [t('admin.s_money_in'), formatRupees(stats.moneyInTodayPaise)],
    [t('admin.s_credit_given'), formatRupees(stats.creditGivenTodayPaise)],
    [t('admin.s_credit'), formatRupees(stats.creditInCirculationPaise)],
  ]

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.overview')}</h1>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <p className="text-caption text-muted">{label}</p>
            <p className="mt-1 font-head text-title font-bold text-primary">{value}</p>
          </Card>
        ))}
      </div>

      {/* A paid row whose credit portion is unknown is left out of Money in
          rather than counted as a full collection — say so instead of hiding it. */}
      {stats.moneyInUnknownToday > 0 ? (
        <p className="mt-2 text-caption text-muted">
          {stats.moneyInUnknownToday} {t('admin.moneyInUnknown')}
        </p>
      ) : null}

      {stats.busiestTrains.length > 0 ? (
        <Card className="mt-4">
          <p className="font-head text-section text-ink">{t('admin.busiest')}</p>
          <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-caption text-muted">
            <span>{t('admin.colTrain')}</span>
            <span>{t('admin.colTrainName')}</span>
            <span>{t('admin.colSwapsDone')}</span>
          </div>
          <ul className="mt-1 space-y-1 text-body text-muted">
            {stats.busiestTrains.map((row) => (
              <li key={row.train_no} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <span>{row.train_no}</span>
                <span className="truncate">{row.train_name}</span>
                <span>{row.swaps}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-4 flex items-start gap-2">
        <Coins aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        <CardBody>{t('admin.creditNever')}</CardBody>
      </Card>

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
