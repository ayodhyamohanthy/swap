import { createFileRoute } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import {
  activityTime,
  adminNoticeKey,
  downloadCsv,
  reportRows,
  reportsToCsv,
  runAdminAction,
  type AdminReportRow,
} from '@/lib/admin'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { useAppState } from '@/lib/use-store'

/* Admin A7 "Reports" (design 18b). A staff queue for bad behaviour — not a
   dispute channel, and it never promises the traveller a reply time (rule 7).

   Design 18b draws User / Issue / Status / Actions, with Review and Close on
   every open row. What this screen had instead was a card per report printing
   the raw action name (`report_filed`) as its title and the entity type
   (`swap_request`) as its status pill — two internal identifiers in the
   positions the design fills with things an operator reads.

   **Two columns are deliberately not the design's.** User wants a name
   (`Karan B`) and `ActivityRow` carries none — the same missing-peer-rows
   blocker as `admin.users.tsx` and design 15's User column. It is filled with
   the swap the report is about, which the design's own Issue column also
   carries, so the row is still identifiable. Issue is an allow-list of report
   *kinds*, never the traveller's free text: `report_filed.reason` is written by
   the caller and the type allows a transcript, which can contain the phone
   number or UPI id `lib/chat-guard.ts` exists to keep off the screen. The
   raw text still reaches the operator through the CSV export, which is a file
   they opened on purpose. */

export const Route = createFileRoute('/admin/reports')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminReports,
})

/* Design 18b's four columns. Fixed tracks for User / Issue so a long reason
   cannot push Status and Actions off the row — the same reasoning as the
   payments table's `TRACKS`, and the same failure it was written after: a
   column that grows shifts every cell after it, and the actions land
   somewhere the eye does not expect. */
const TRACKS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6rem_auto]'

function issueLabel(row: AdminReportRow, t: (key: MessageKey) => string): string {
  /* The allow-list is keyed by the same convention as `admin.act.*` — the key
     name IS the mapping — so an unrecognised report needs no new key and
     cannot fall through to blank. */
  return row.issue ? t(`admin.report_${row.issue}` as MessageKey) : t('admin.report_other')
}

function AdminReports() {
  const { t, date, lang } = useI18n()
  const { activity } = useAppState()
  const rows = reportRows(activity)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function close(row: AdminReportRow) {
    if (busy) return
    setBusy(row.id)
    const result = await runAdminAction('close_report', { target: row.request_id ?? row.id })
    setBusy(null)
    if (result.outcome === 'applied') setClosed((prev) => new Set(prev).add(row.id))
    setNotice(t(adminNoticeKey(result, 'admin.closed')))
  }

  /* The local Close is a device-side state until `report_closed` lands in the
     log, which is the same way the activity log treats a fallback. A row is
     closed if the log says so, or if this screen just closed it. */
  const isClosed = (row: AdminReportRow) => row.closed || closed.has(row.id)

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.reports')}</h1>
      <p className="mt-1 text-body text-muted">{t('admin.reportsSub')}</p>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        /* One DOM, two layouts — the payments and activity tables do the same.
           Below `lg` each row is a card; at `lg` the same elements land in
           design 18b's four columns. */
        <div className="mt-4 lg:overflow-hidden lg:rounded-card lg:border lg:border-line lg:bg-card">
          {/* The ruler, and the only place the column names appear. Every child
              is placed explicitly, here and in every row: auto-placement moves a
              cell's column the moment a row has one grid item fewer. */}
          <div
            className={`hidden lg:grid ${TRACKS} lg:gap-4 lg:border-b lg:border-line lg:px-4 lg:py-2 lg:text-caption lg:font-semibold lg:uppercase lg:tracking-wide lg:text-muted`}
          >
            <span className="lg:col-start-1">{t('admin.colUser')}</span>
            <span className="lg:col-start-2">{t('admin.colIssue')}</span>
            <span className="lg:col-start-3">{t('admin.colStatus')}</span>
            <span className="lg:col-start-4">{t('admin.colActions')}</span>
          </div>

          <ul className="space-y-2 lg:space-y-0">
            {rows.map((row) => {
              const rowClosed = isClosed(row)
              return (
                <li
                  key={row.id}
                  className="rounded-card border border-line bg-card p-3 lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:px-4 lg:py-3 lg:last:border-b-0"
                >
                  <div
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 ${TRACKS} lg:items-baseline lg:gap-x-4 lg:gap-y-0`}
                  >
                    <span className="col-start-1 row-start-1 min-w-0 lg:col-start-1 lg:row-start-1">
                      <b
                        className="block truncate font-head text-body text-ink"
                        title={row.request_id ?? row.id}
                      >
                        {row.request_id ? t('admin.report_about', { swap: row.request_id }) : '—'}
                      </b>
                      <small className="block text-caption text-muted lg:hidden">
                        {date(row.created_at.slice(0, 10))} · {activityTime(row.created_at, lang)}
                      </small>
                    </span>

                    {/* `lg:contents` dissolves this wrapper at desktop width, so
                        its children become grid items in their own columns; below
                        `lg` it is one wrapped token line. That is why it must
                        stay a direct child of the grid. */}
                    <span className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted lg:contents">
                      <span className="lg:col-start-2 lg:row-start-1 lg:text-body lg:text-ink">
                        {issueLabel(row, t as never)}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="lg:col-start-3 lg:row-start-1">
                        <Pill tone={rowClosed ? 'neutral' : 'accent'}>
                          {rowClosed ? t('admin.closed') : t('admin.open')}
                        </Pill>
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="lg:col-start-4 lg:row-start-1">
                        <Button size="sm" variant="outline" disabled>
                          <Eye aria-hidden className="size-4" />
                          {t('admin.review')}
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant={rowClosed ? 'neutral' : 'primary'}
                          disabled={rowClosed || busy === row.id}
                          onClick={() => void close(row)}
                        >
                          {t('admin.close')}
                        </Button>
                      </span>
                    </span>
                  </div>

                  {/* When, on its own line below `lg` only. At `lg` the date and
                      time ride inside the User cell, as they do on designs 15
                      and 18a — an operator's queue is ordered by when. */}
                  <span className="sr-only lg:hidden">
                    {date(row.created_at.slice(0, 10))} · {activityTime(row.created_at, lang)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-caption text-muted">{t('admin.demoNote')}</p>
        <Button size="sm" onClick={() => downloadCsv('seatswap-reports.csv', reportsToCsv(rows))}>
          {t('admin.csv')}
        </Button>
      </div>

      {notice ? (
        <p className="mt-3 text-caption font-semibold text-primary">{notice}</p>
      ) : null}
    </div>
  )
}
