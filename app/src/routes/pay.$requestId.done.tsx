import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, revealedBerths } from '@/lib/requests'
import { splitReceipt } from '@/lib/payments'
import { formatRupees } from '@/lib/money'
import { isGroupRequestId } from '@/lib/groups'
import { gatewayLive } from '@/lib/checkout'
import { usePaymentFor } from '@/lib/use-store'
import { payGate } from './pay.$requestId'

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
            to={payGate(request?.status) === 'paid' ? '/swaps/$id' : '/pay/$requestId/status'}
            params={payGate(request?.status) === 'paid' ? { id: requestId } : { requestId }}
            {...(payGate(request?.status) === 'paid' ? {} : { search: { state: 'pending' as const } })}
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
  const receipt = splitReceipt(payment.amount_paise, payment.credit_used_paise, isGroup)
  const berths = revealedBerths(requestId)
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.done')}</h1>
      <p className="mt-1 text-body text-muted">
        {t('pay.paidLine', {
          amount: formatRupees(payment.amount_paise),
          method: payment.provider === 'credit' ? t('profile.credit') : payment.provider === 'paypal' ? 'PayPal' : 'Razorpay',
        })}
      </p>
      <Card className="mt-4">
        <CardTitle>{t('pay.receipt', { n: payment.receipt_number ?? '' })}</CardTitle>
        <dl className="mt-2 text-body">
          {receipt.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-1">
              <dt className="text-muted">
                {line.label === 'thank_you' ? t('pay.receiptThanksFor', { name }) : t(LINE_KEY[line.label as keyof typeof LINE_KEY])}
              </dt>
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
