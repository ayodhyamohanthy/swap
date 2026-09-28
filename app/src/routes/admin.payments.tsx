import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import {
  activityTime,
  buildOverview,
  downloadCsv,
  PAYMENT_OUTCOME_LABEL,
  PAYMENT_STATE_LABEL,
  paymentRows,
  paymentsToCsv,
  shortId,
  type AdminPaymentRow,
  type PaymentOutcome,
} from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState, useRequestsState } from '@/lib/use-store'

/* Admin A5 "Payments" (design 18). A payment row only exists once a swap is
   locked. Amounts are integer paise end to end: ₹99 = ₹49 fee + ₹50 credit,
   and the group price is ₹199 for up to 3 swaps.

   This screen used to render `const rows: AdminPaymentRow[] = []` — a literal
   empty array, so it could not show a payment that existed, under a comment
   asserting the emptiness was legitimate because "nothing is captured until a
   provider webhook confirms it". Wrong twice: `usePayments()` already existed
   in `lib/use-store.ts`, and the local path does record payments —
   `startPayment` writes a `PaymentRow` and a `payment_created` log line the
   moment checkout opens. The empty list was the code, not the state. */

export const Route = createFileRoute('/admin/payments')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminPayments,
})

/* Design 18 draws "Paid" green and "To credit" amber — the same two words and
   the same split design 17 uses, because they are the same two money states.
   `pending` is amber while the money is still in flight; `failed` is the one
   red. */
const OUTCOME_TONE: Record<PaymentOutcome, 'primary' | 'accent' | 'danger' | 'neutral'> = {
  paid: 'primary',
  to_credit: 'accent',
  pending: 'accent',
  failed: 'danger',
}

/* Five tracks, defined once: the header ruler and every row must agree, and two
   copies of this string is two chances for the table to drift out of line.

   Design 18 leads with Time. Swap leads here instead, matching design 17's
   sibling table — the row's identity first, and DOM order equal to visual order
   so a screen reader hears the columns in the order they are drawn. Filed as a
   deviation rather than matched. */
const TRACKS = 'lg:grid-cols-[6.5rem_6rem_minmax(0,1fr)_minmax(0,1fr)_6rem]'

/* Design 18 shows `22:41` beside a date, and `useI18n().date` renders in local
   time — so the clock has to as well, or an evening payment lands on the wrong
   day for an IST operator. `activityTime` already does exactly this (design 15
   needed it first); an ISO slice here would be UTC. */

/**
 * Design 18's Method column.
 *
 * The design names the *instrument* — `UPI`, `UPI + credit`, `Card`. The system
 * records only the provider: `PaymentRow` has no instrument field, and
 * `pay.$requestId.method.tsx` collects the choice, passes it to `pay()`, and
 * drops it. So this shows the provider plus whether credit formed part of the
 * payment, which is the design's `UPI + credit` structure at the granularity
 * that exists. Filed to the lanes owning the pay routes and the store rather
 * than invented here.
 */
function methodLabel(row: AdminPaymentRow, creditLabel: string): string {
  if (row.provider === 'credit') return creditLabel
  const provider = row.provider === 'paypal' ? 'PayPal' : 'Razorpay'
  return row.credit_used_paise > 0 ? `${provider} + ${creditLabel}` : provider
}

function AdminPayments() {
  const { t, date, lang } = useI18n()
  const { activity, wallet, payments, trips } = useAppState()
  const { requests } = useRequestsState()

  const rows = paymentRows(payments, wallet)
  const stats = buildOverview({ activity, wallet, payments, requests, trips })

  /* Design 18's four tiles. Every one is today-scoped, and every label says so
     — the design writes "today" on the first tile only, but the repo's own
     convention (`s_money_in` = "Money in today") is to name the window, and a
     tile reading "Credit used" over today's number is the defect this lane
     keeps finding. `creditGivenTodayPaise` CONTAINS `movedToCreditTodayPaise`,
     so the two are shown side by side and never added. */
  const tiles: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: t('admin.s_money_in'), value: formatRupees(stats.moneyInTodayPaise) },
    {
      label: t('admin.movedToCreditToday'),
      value: formatRupees(stats.movedToCreditTodayPaise),
      highlight: true,
    },
    { label: t('admin.s_credit_given'), value: formatRupees(stats.creditGivenTodayPaise) },
    { label: t('admin.creditUsedToday'), value: formatRupees(stats.creditUsedTodayPaise) },
  ]

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.payments')}</h1>
      <p className="mt-1 text-body text-muted">{t('admin.paymentsSub')}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          /* The design tints the "Moved to credit" tile amber — it is the one
             tile that describes money leaving, and the one an operator acts on. */
          <Card
            key={tile.label}
            className={tile.highlight ? 'border-accent-soft bg-accent-soft' : undefined}
          >
            <p className="text-caption text-muted">{tile.label}</p>
            <p className="mt-1 font-head text-section font-bold tabular-nums text-ink">
              {tile.value}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <h2 className="font-head text-section font-bold text-ink">{t('admin.payments')}</h2>
        <Button
          size="sm"
          onClick={() => downloadCsv('seatswap-payments.csv', paymentsToCsv(rows))}
        >
          {t('admin.csv')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="mt-3">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        /* One DOM, two layouts — the same approach as the activity and swaps
           tables. Below `lg` each row is a card; at `lg` the same elements are
           placed into design 18's columns. Two markups would be two places for
           the values to drift apart. */
        <div className="mt-3 lg:overflow-hidden lg:rounded-card lg:border lg:border-line lg:bg-card">
          {/* The ruler, and the only place the column names appear. Every child
              is placed explicitly, here and in every row: leaving any of them to
              auto-placement makes a cell change columns as soon as a row has one
              grid item fewer. */}
          <div
            className={`hidden lg:grid ${TRACKS} lg:gap-4 lg:border-b lg:border-line lg:px-4 lg:py-2 lg:text-caption lg:font-semibold lg:uppercase lg:tracking-wide lg:text-muted`}
          >
            <span className="lg:col-start-1">{t('admin.colSwap')}</span>
            <span className="lg:col-start-2">{t('admin.colWhen')}</span>
            <span className="lg:col-start-3">{t('admin.colAmount')}</span>
            <span className="lg:col-start-4">{t('admin.colMethod')}</span>
            <span className="lg:col-start-5">{t('admin.colStatus')}</span>
          </div>

          <ul className="space-y-2 lg:space-y-0">
            {rows.map((row) => {
              const creditLabel = t('profile.credit')
              /* The precise payment state, in the app's own words. The design's
                 Status column shows the coarse outcome; a staff member who needs
                 `created` vs `pending` gets it on hover. */
              const exact = t(PAYMENT_STATE_LABEL[row.status])

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
                        title={row.request_id}
                      >
                        {shortId(row.request_id)}
                      </b>
                    </span>

                    {/* `lg:contents` dissolves this wrapper at desktop width, so
                        its children become grid items in their own columns;
                        below `lg` it is one wrapped token line. That is why it
                        has to stay a direct child of the grid — nesting it in a
                        cell would make its children flex items instead. */}
                    <span className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted lg:contents">
                      {/* Date AND time, the same pair the activity log shows: a
                          day alone cannot order two payments on one day, and
                          `lg:whitespace-nowrap` keeps the pair on one line once
                          it becomes its own column. */}
                      <span className="lg:col-start-2 lg:row-start-1 lg:whitespace-nowrap">
                        {date(row.created_at.slice(0, 10))} · {activityTime(row.created_at, lang)}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      {/* Amount is what the gateway actually captured — gross
                          minus credit used — which is the design's ₹49 on a ₹99
                          swap paid with ₹50 credit, and the same definition as
                          `moneyInTodayPaise` and design 17's Amount column. The
                          gross and the credit share are on the tooltip, because
                          `₹49` alone cannot say whether ₹50 of credit was used. */}
                      <span
                        className="lg:col-start-3 lg:row-start-1 lg:text-body lg:text-ink lg:tabular-nums"
                        title={
                          row.credit_used_paise > 0
                            ? `${formatRupees(row.amount_paise)} − ${formatRupees(row.credit_used_paise)} ${creditLabel}`
                            : formatRupees(row.amount_paise)
                        }
                      >
                        {formatRupees(row.received_paise)}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="lg:col-start-4 lg:row-start-1">
                        {methodLabel(row, creditLabel)}
                      </span>
                    </span>

                    <span className="col-start-3 row-start-1 lg:col-start-5 lg:row-start-1">
                      {/* `Pill` takes no `title` of its own, and it belongs to
                          another lane — the wrapper carries the tooltip rather
                          than the shared component growing a prop for one
                          caller. */}
                      <span title={exact}>
                        <Pill tone={OUTCOME_TONE[row.outcome]}>
                          {t(PAYMENT_OUTCOME_LABEL[row.outcome])}
                        </Pill>
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
