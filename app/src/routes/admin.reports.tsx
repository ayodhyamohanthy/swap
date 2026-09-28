import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { activityToCsv, adminNoticeKey, downloadCsv, runAdminAction } from '@/lib/admin'
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
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function close(id: string) {
    if (busy) return
    setBusy(id)
    const result = await runAdminAction('close_report', { target: id })
    setBusy(null)
    if (result.outcome === 'applied') setClosed((prev) => new Set(prev).add(id))
    setNotice(t(adminNoticeKey(result, 'admin.closed')))
  }

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
          {rows.map((row) => {
            const isClosed = closed.has(row.id) || row.action === 'report_closed'
            return (
              <li
                key={row.id}
                className="rounded-card border border-line bg-card p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <b className="block truncate font-head text-body text-ink">{row.action}</b>
                    <small className="block text-caption text-muted">
                      {date(row.created_at.slice(0, 10))}
                    </small>
                  </span>
                  <Pill tone={row.action === 'report_filed' && !isClosed ? 'danger' : 'neutral'}>
                    {isClosed ? t('admin.closed') : (row.entity ?? '—')}
                  </Pill>
                </div>
                {!isClosed ? (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.id}
                      onClick={() => void close(row.id)}
                    >
                      {t('admin.close')}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {notice ? (
        <p className="mt-3 text-caption font-semibold text-primary">{notice}</p>
      ) : null}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
