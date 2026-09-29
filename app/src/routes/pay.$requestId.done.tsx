import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, revealedBerths } from '@/lib/requests'
import { splitReceipt, type ReceiptLine } from '@/lib/payments'
import { formatRupees } from '@/lib/money'
import { isGroupRequestId } from '@/lib/groups'
import { gatewayLive, payGateFor } from '@/lib/checkout'
import { usePaymentFor } from '@/lib/use-store'

/* Payment successful (docs/04 A11, design 27c): the receipt is built from the
   payment row that actually exists, then the berth numbers are revealed and
   chat opens. Nothing here renders until the payment says `paid`. */
export const Route = createFileRoute('/pay/$requestId/done')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: DoneScreen,
})

const LINE_KEY = {
  fee: 'pay.receiptFee',
  thank_you: 'pay.receiptThanks',
  group_cover: 'pay.groupCover',
  credit_used: 'pay.creditUsed',
} as const

function DoneScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const payment = usePaymentFor(requestId)
  const request = getRequest(requestId)
  /* Where to send someone who landed here with no paid payment row. Reads the
     request, not the group id, so a group trip keeps its Check-status route. */
  const settled = request ? payGateFor(request.id) === 'paid' : false

  if (!payment || payment.status !== 'paid') {
    /* Rule 2: no money, no lock, no success screen. */
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('pay.pendingTitle')}</CardTitle>
          <CardBody>{t('pay.pending')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link
            to={settled ? '/swaps/$id' : '/pay/$requestId/status'}
            params={settled ? { id: requestId } : { requestId }}
            {...(settled ? {} : { search: { state: 'pending' as const } })}
          >
            {t('pay.checkStatus')}
          </Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  const isGroup = isGroupRequestId(requestId)
  const name = acceptedOffer(requestId)?.acceptor_name ?? t('common.traveller')
  /* `amount_paise` is GROSS; `receipt.total` is the cash the gateway captured.
     The "… paid · Razorpay" line below used the gross, so a credit-covered
     swap told the payer that Razorpay had taken ₹99 when it took ₹49. The
     method named and the amount named have to be the same transaction. */
  const receipt = splitReceipt(payment.amount_paise, payment.credit_used_paise, isGroup)
  /* One label per line, for both branches. The group branch looked the key up
     raw, and `pay.creditUsed` is "Credit used ₹{amount}" — `fill` blanks a
     variable it was not given, silently, so a group payment that spent credit
     printed "Credit used ₹" with no number in it at all. A missing figure that
     leaves a well-formed sentence behind is the same defect as the ₹0 this
     screen's sibling showed: the reader cannot tell it is broken.
     `withName` is the one genuine difference — a group payment has no single
     acceptor to name (design 29b), a single swap does (design 27c). */
  const labelFor = (line: ReceiptLine, withName: boolean) =>
    line.label === 'credit_used'
      ? t('pay.creditUsed', { amount: Math.abs(line.amountPaise) / 100 })
      : line.label === 'thank_you' && withName
        ? t('pay.receiptThanksFor', { name })
        : t(LINE_KEY[line.label as keyof typeof LINE_KEY])
  const berths = revealedBerths(requestId)
  if (isGroup) {
    /* A group payment covers the trip, not one swap: no berth reveal here,
       just the receipt and the way back to the family trip. */
    const groupId = requestId
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.done')}</h1>
        <p className="mt-1 text-body text-muted">
          {t('pay.paidLine', {
            amount: formatRupees(receipt.total),
            method: payment.provider === 'credit' ? t('profile.credit') : payment.provider === 'paypal' ? 'PayPal' : 'Razorpay',
          })}
        </p>
        <Card className="mt-4">
          <CardTitle>{t('pay.receipt', { n: payment.receipt_number ?? '' })}</CardTitle>
          <dl className="mt-2 text-body">
            {receipt.lines.map((line) => (
              <div key={line.label} className="flex items-center justify-between py-1">
                <dt className="text-muted">{labelFor(line, false)}</dt>
                <dd className="font-head font-bold text-ink">{formatRupees(line.amountPaise)}</dd>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
              <dt className="font-head font-bold text-ink">{t('payments.total', { amount: receipt.total / 100 })}</dt>
              <dd className="font-head text-title font-bold text-primary">{formatRupees(receipt.total)}</dd>
            </div>
          </dl>
        </Card>
        <p className="mt-3 text-body text-muted">{t('groups.paid')}</p>
        <Button className="mt-4" asChild>
          <Link to="/groups/$id" params={{ id: groupId }}>{t('pay.seeDetails')}</Link>
        </Button>
        <Button variant="ghost" className="mt-2" asChild>
          <Link to="/profile/payments/$id" params={{ id: payment.id }}>{t('pay.download')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.done')}</h1>
      <p className="mt-1 text-body text-muted">
        {t('pay.paidLine', {
          amount: formatRupees(receipt.total),
          method: payment.provider === 'credit' ? t('profile.credit') : payment.provider === 'paypal' ? 'PayPal' : 'Razorpay',
        })}
      </p>
      <Card className="mt-4">
        <CardTitle>{t('pay.receipt', { n: payment.receipt_number ?? '' })}</CardTitle>
        <dl className="mt-2 text-body">
          {receipt.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-1">
              <dt className="text-muted">{labelFor(line, true)}</dt>
              <dd className="font-head font-bold text-ink">{formatRupees(line.amountPaise)}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-head font-bold text-ink">{t('payments.total', { amount: receipt.total / 100 })}</dt>
            <dd className="font-head text-title font-bold text-primary">{formatRupees(receipt.total)}</dd>
          </div>
        </dl>
      </Card>
      {!gatewayLive() ? (
        <p className="mt-2 text-caption text-muted">{t('payments.demo')}</p>
      ) : null}

      <Card className="mt-3">
        <CardTitle>{t('pay.berthReveal')}</CardTitle>
        <CardBody>
          {t('summary.youGive', { berth: berths?.mine ?? t('trip.berthMasked') })} ·{' '}
          {t('summary.youGet', { berth: berths?.theirs ?? t('trip.berthMasked') })}
        </CardBody>
      </Card>

      <Button className="mt-4" asChild>
        <Link to="/swaps/$id/summary" params={{ id: requestId }}>{t('pay.seeDetails')}</Link>
      </Button>
      <Button variant="outline" className="mt-2" asChild>
        <Link to="/chat/$id" params={{ id: requestId }}>{t('pay.openChat')}</Link>
      </Button>
      <Button variant="ghost" className="mt-2" asChild>
        <Link to="/profile/payments/$id" params={{ id: payment.id }}>{t('pay.download')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
