import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Coins } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { buildOverview } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState } from '@/lib/use-store'

/* Admin A1 "Overview" (design 23). Today at a glance, straight from this
   device's activity_log until the backend is wired. Money stays in paise. */

export const Route = createFileRoute('/admin/_index')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminOverview,
})

function AdminOverview() {
  const { t } = useI18n()
  const { activity, wallet } = useAppState()
  const stats = buildOverview({ activity, walletTotalPaise: wallet.reduce((n, row) => n + row.amount_paise, 0) })

  const tiles: Array<[string, string | number]> = [
    [t('admin.s_pnrs'), stats.pnrsToday],
    [t('admin.s_requests'), stats.requestsToday],
    [t('admin.s_paid'), stats.paidToday],
    [t('admin.s_confirmed'), stats.confirmedToday],
    [t('admin.s_credit'), formatRupees(stats.creditIssuedPaise)],
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

      {stats.busiestTrains.length > 0 ? (
        <Card className="mt-4">
          <p className="font-head text-section text-ink">{t('admin.busiest')}</p>
          <ul className="mt-2 space-y-1 text-body text-muted">
            {stats.busiestTrains.map((row) => (
              <li key={row.train_no} className="flex justify-between">
                <span>{row.train_no}</span>
                <span>{row.count}</span>
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
