import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { splitReceipt } from '@/lib/payments'
import { getPayment } from '@/lib/store'
import { isGroupRequestId } from '@/lib/groups'

/* Screen 59 "Receipt" (design 29b, docs/06). Every figure comes from the
   stored payment row — amount, credit used, and the SS-##### number assigned
   when it turned paid. Nothing is recomputed or fabricated: a credit-covered
   or group payment shows its real totals. */

export const Route = createFileRoute('/profile/payments/$id')({
  staticData: { chrome: 'tabs', tab: 'profile' } satisfies RouteChrome,
  component: ReceiptScreen,
})

const LINE_KEY = {
  fee: 'pay.receiptFee',
  thank_you: 'pay.receiptThanks',
  group_cover: 'pay.groupCover',
  credit_used: 'pay.creditUsed',
} as const

function ReceiptScreen() {
  const { id } = Route.useParams()
  const { t, date } = useI18n()
  const payment = getPayment(id)

  if (!payment) {
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/profile/payments">{t('nav.profile')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  const isGroup = isGroupRequestId(payment.request_id ?? payment.group_id ?? '')
  const receipt = splitReceipt(payment.amount_paise, payment.credit_used_paise, isGroup)
  const number = payment.receipt_number ?? ''

  return (
    <div>
      <h1 className="text-title text-ink">{t('payments.receipt', { n: number })}</h1>

      <Card className="mt-4">
        <CardTitle>{isGroup ? t('pay.groupTitle') : t('pay.pay99')}</CardTitle>
        <dl className="mt-2 text-body">
          {receipt.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-1">
              <dt className="text-muted">
                {line.label === 'credit_used'
                  ? t('pay.creditUsed', { amount: Math.abs(line.amountPaise) / 100 })
                  : t(LINE_KEY[line.label as keyof typeof LINE_KEY])}
              </dt>
              <dd className="font-head font-bold text-ink">{formatRupees(line.amountPaise)}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-head font-bold text-ink">
              {t('payments.total', { amount: receipt.total / 100 })}
            </dt>
            <dd className="font-head text-title font-bold text-primary">
              {formatRupees(receipt.total)}
            </dd>
          </div>
        </dl>
        <CardBody>
          {t('pay.receipt', { n: number })} · {date(payment.created_at.slice(0, 10))}
        </CardBody>
      </Card>

      <p className="mt-4 text-body font-semibold text-ink">{t('pay.under')}</p>

      <AppFooter />
    </div>
  )
}
