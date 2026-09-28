import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/pill'
import {
  acceptorName,
  adminNoticeKey,
  collectedPaise,
  downloadCsv,
  filterSwaps,
  runAdminAction,
  shortId,
  SWAP_PHASES,
  SWAP_PHASE_LABEL,
  swapPhase,
  swapsToCsv,
  type AdminSwapRow,
  type SwapPhase,
} from '@/lib/admin'
import { applyResolution, voidSwap } from '@/lib/settle'
import { resolveConfirmations } from '@/lib/outcomes'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { useRequestsState } from '@/lib/use-store'
import { getTrip, paymentFor } from '@/lib/store'
import { formatRupees } from '@/lib/money'

/* Admin A4 "Swaps" (design 17). Shows the requester's PNR last4 only — never the
   full PNR (rule 13). The Status column reads in the design's words and the
   precise state stays as a tooltip, the same split the activity log uses. */

export const Route = createFileRoute('/admin/swaps')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminSwaps,
})

/* Design 17 draws five chips — Waiting / Accepted / Paid / Done / To credit —
   and `RequestStatus` has nine values, so five chips cannot reach four of them,
   including `disputed`: the only state where money is held and a person has to
   decide. The extra two chips are a deliberate deviation, recorded on the
   board, because a filter that cannot reach a state is a filter that hides
   rows. The labels live in lib/admin.ts so a test can check both languages. */

/* The label says which phase; the tone says whether it is settled. Design 17
   draws Waiting and To credit amber and Paid and Done green, which is the same
   split — green once the swap has happened or the money has arrived, amber
   while something is still pending. `disputed` is the one red. */
const PHASE_TONE: Record<SwapPhase, 'primary' | 'accent' | 'danger' | 'neutral'> = {
  waiting: 'accent',
  accepted: 'accent',
  paid: 'primary',
  done: 'primary',
  to_credit: 'accent',
  disputed: 'danger',
  closed: 'neutral',
}

/* Six tracks, defined once: the header ruler and every row must agree, and two
   copies of this string is two chances for the table to drift out of line. */
const TRACKS = 'lg:grid-cols-[6.5rem_5rem_minmax(0,1fr)_minmax(0,1fr)_7rem_5.5rem]'

/* `shortId` moved to `lib/admin.ts`: design 18's payments table draws the same
   Swap column, and one definition means the two tables cannot disagree. */

function AdminSwaps() {
  const { t, date } = useI18n()
  const { requests, offers } = useRequestsState()
  const [phase, setPhase] = useState<SwapPhase | 'all'>('all')
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
      acceptor_name: acceptorName(request, offers),
      amount_paise: collectedPaise(paymentFor(request.id)),
      phase: swapPhase(request.status),
      updated_at: request.updated_at.slice(0, 10),
    }
  })

  const shown = filterSwaps(rows, phase === 'all' ? null : phase)

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.swaps')}</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => downloadCsv('seatswap-swaps.csv', swapsToCsv(shown))}
        >
          {t('admin.csv')}
        </Button>
      </div>

      {/* Every phase is offered, present or not, so the chips do not move under
          an operator's thumb as rows come and go. `admin.colStatus` labels the
          group rather than a new key: it is a status filter. */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('admin.colStatus')}>
        {(['all', ...SWAP_PHASES] as const).map((chip) => (
          <Button
            key={chip}
            size="sm"
            variant={chip === phase ? 'primary' : 'neutral'}
            aria-pressed={chip === phase}
            onClick={() => setPhase(chip)}
          >
            {t(SWAP_PHASE_LABEL[chip])}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        /* One DOM, two layouts — the same approach as the activity log. Below
           `lg` each row is a card; at `lg` the same elements are placed into
           design 17's six columns. Two separate markups would be two places for
           the values to drift apart. */
        <div className="mt-4 lg:overflow-hidden lg:rounded-card lg:border lg:border-line lg:bg-card">
          {/* The ruler, and the only place the column names appear. Every child
              is placed explicitly, here and in every row: leaving any of them to
              auto-placement makes a cell change columns as soon as a row has one
              grid item fewer — the bug the activity table shipped first. */}
          <div
            className={`hidden lg:grid ${TRACKS} lg:gap-4 lg:border-b lg:border-line lg:px-4 lg:py-2 lg:text-caption lg:font-semibold lg:uppercase lg:tracking-wide lg:text-muted`}
          >
            <span className="lg:col-start-1">{t('admin.colSwap')}</span>
            <span className="lg:col-start-2">{t('admin.colTrain')}</span>
            <span className="lg:col-start-3">{t('admin.colRequester')}</span>
            <span className="lg:col-start-4">{t('admin.colAcceptor')}</span>
            <span className="lg:col-start-5">{t('admin.colStatus')}</span>
            <span className="lg:col-start-6">{t('admin.colAmount')}</span>
          </div>

          <ul className="space-y-2 lg:space-y-0">
            {shown.map((row) => {
              const actionable = row.status === 'locked' || row.status === 'disputed'
              const tone = PHASE_TONE[row.phase]
              /* The precise state, in the app's own words. Design 17 shows the
                 phase; a staff member who needs `locked` vs `confirmed` gets it
                 on hover rather than in a second column. */
              const exact = `request.statuses.${row.status}` as MessageKey

              return (
                <li
                  key={row.id}
                  className="rounded-card border border-line bg-card p-3 lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:px-4 lg:py-3 lg:last:border-b-0"
                >
                  <div
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 ${TRACKS} lg:items-baseline lg:gap-x-4 lg:gap-y-0`}
                  >
                    {/* The design's Swap column. It carries the journey date
                        too: a swap id with no date is not an audit trail, and
                        the design has no seventh column to put one in. */}
                    <span className="col-start-1 row-start-1 min-w-0 lg:col-start-1 lg:row-start-1">
                      <b
                        className="block truncate font-head text-body text-ink"
                        title={row.id}
                      >
                        {shortId(row.id)}
                      </b>
                      {row.journey_date ? (
                        <small className="block truncate text-caption text-muted">
                          {date(row.journey_date)}
                        </small>
                      ) : null}
                    </span>

                    {/* `lg:contents` dissolves this wrapper at desktop width, so
                        its children become grid items in their own columns;
                        below `lg` it is one wrapped token line. That is why it
                        has to stay a direct child of the grid — nesting it in a
                        cell would make its children flex items instead. */}
                    <span className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted lg:contents">
                      <span className="lg:col-start-2 lg:row-start-1 lg:text-body lg:text-ink">
                        {row.train_no}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      {/* Rule 13: the design names the requester, and the local
                          model has no requester name — `SwapRequest` carries a
                          nullable `requester_id` and nothing else. The masked
                          PNR last4 is the only requester identifier that exists,
                          and it is what this screen has always shown. */}
                      <span className="lg:col-start-3 lg:row-start-1">
                        ••{row.requester_last4}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      {/* The design's own convention for a party that does not
                          exist yet, which is exactly the Waiting row. */}
                      <span className="lg:col-start-4 lg:row-start-1">
                        {row.acceptor_name ?? '—'}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="lg:col-start-6 lg:row-start-1 lg:text-body lg:text-ink lg:tabular-nums">
                        {formatRupees(row.amount_paise)}
                      </span>
                    </span>

                    <span className="col-start-3 row-start-1 lg:col-start-5 lg:row-start-1">
                      {/* `Pill` takes no `title` of its own, and it belongs to
                          another lane — the wrapper carries the tooltip rather
                          than the shared component growing a prop for one
                          caller. */}
                      <span title={t(exact)}>
                        <Pill tone={tone}>{t(SWAP_PHASE_LABEL[row.phase])}</Pill>
                      </span>
                    </span>
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
        </div>
      )}

      {notice ? (
        <p className="mt-3 text-caption font-semibold text-primary">{notice}</p>
      ) : null}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
