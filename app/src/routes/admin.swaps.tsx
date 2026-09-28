import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/pill'
import { adminNoticeKey, downloadCsv, runAdminAction, swapsToCsv, type AdminSwapRow } from '@/lib/admin'
import { applyResolution, voidSwap } from '@/lib/settle'
import { resolveConfirmations } from '@/lib/outcomes'
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
  const [busy, setBusy] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  async function act(
    action: 'move_to_credit' | 'mark_done',
    row: AdminSwapRow,
    extra: { reason?: string } = {},
  ) {
    if (busy) return
    setBusy(row.id)
    /* Local rows carry no server user ids, so money can only move where the
       backend resolves the parties. On this device the same tap settles the
       local swap through the same rules (settle.ts) and is audit-logged. */
    const result = await runAdminAction(action, {
      target: row.id,
      reason: extra.reason,
      requestId: row.id,
    })
    /* No backend: settle the local swap through the same rules (settle.ts) so
       the demo still walks end to end. A backend that REFUSED the action
       settles nothing here — keeping those two apart is the whole point. */
    if (result.outcome === 'device') {
      if (action === 'move_to_credit') voidSwap(row.id)
      else applyResolution(row.id, resolveConfirmations('swapped', 'swapped'))
    }
    setBusy(null)
    setReasonFor(null)
    setReason('')
    setNotice(t(adminNoticeKey(result, 'admin.acted')))
  }

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
          {rows.map((row) => {
            const actionable = row.status === 'locked' || row.status === 'disputed'
            return (
              <li
                key={row.id}
                className="rounded-card border border-line bg-card p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <b className="block truncate font-head text-body text-ink">
                      {row.train_no} · PNR ••{row.requester_last4}
                    </b>
                    <small className="block text-caption text-muted">{date(row.journey_date)}</small>
                  </span>
                  <Pill tone={row.status === 'locked' ? 'primary' : 'neutral'}>{row.status}</Pill>
                </div>
                {actionable ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.id}
                      onClick={() => void act('mark_done', row)}
                    >
                      {t('admin.markDone')}
                    </Button>
                    {reasonFor === row.id ? (
                      <span className="flex min-w-44 flex-1 gap-2">
                        <Field label={t('admin.reasonPh')} htmlFor={`admin-reason-${row.id}`}>
                          <Input
                            id={`admin-reason-${row.id}`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('admin.reasonPh')}
                          />
                        </Field>
                        <Button
                          size="sm"
                          disabled={busy === row.id || !reason.trim()}
                          onClick={() => void act('move_to_credit', row, { reason: reason.trim() })}
                        >
                          {t('admin.moveCredit')}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.id}
                        onClick={() => { setReasonFor(row.id); setReason(''); setNotice(null) }}
                      >
                        {t('admin.moveCredit')}
                      </Button>
                    )}
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
