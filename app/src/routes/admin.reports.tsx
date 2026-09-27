import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { activityToCsv, downloadCsv } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { useAppState } from '@/lib/use-store'

/* Admin A7 "Reports" (design 24). Reads the `report_filed` and `block` rows out
   of the activity log. This is a staff queue for bad behaviour — not a dispute
   channel, and it never promises the traveller a reply time (rule 7). */

export const Route = createFileRoute('/admin/reports')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminReports,
})

const REPORT_ACTIONS = new Set(['report_filed', 'block', 'report_closed'])

function AdminReports() {
  const { t, date } = useI18n()
  const { activity } = useAppState()
  const rows = activity.filter((row) => REPORT_ACTIONS.has(row.action))

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.reports')}</h1>

      <button
        type="button"
        className="mt-4 min-h-12 rounded-btn border border-line bg-card px-4 text-body font-bold text-primary"
        onClick={() => downloadCsv('seatswap-reports.csv', activityToCsv(rows))}
      >
        {t('admin.csv')}
      </button>

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
                <b className="block truncate font-head text-body text-ink">{row.action}</b>
                <small className="block text-caption text-muted">
                  {date(row.created_at.slice(0, 10))}
                </small>
              </span>
              <Pill tone={row.action === 'report_filed' ? 'danger' : 'neutral'}>
                {row.entity ?? '—'}
              </Pill>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
