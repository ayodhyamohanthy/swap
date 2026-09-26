import { createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { demoRequest } from '@/lib/demo-swap'
import { formatRupees } from '@/lib/money'
import { receiptNumber, splitReceipt } from '@/lib/payments'

/* Screen 59 "Receipt" (design 29b, docs/06). ₹99 always splits into ₹49 fee +
   ₹50 thank-you credit. The number format is SS-#####; the total is shown in
   rupees while every stored amount stays in integer paise. */

export const Route = createFileRoute('/profile/payments/$id')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ReceiptScreen,
})

function ReceiptScreen() {
  const { id } = Route.useParams()
  const { t, date } = useI18n()
  const request = demoRequest(id)
  const receipt = splitReceipt(9900, 0, request.isGroup)
  const number = receiptNumber(id.length * 7919 + 10482)

  return (
    <div>
      <h1 className="text-title text-ink">{t('payments.receipt', { n: number })}</h1>
      <p className="mt-1 text-caption text-muted">{t('payments.demo')}</p>

      <Card className="mt-4">
        <CardTitle>{t('pay.title', { name: request.acceptorName })}</CardTitle>
        <dl className="mt-2 text-body">
          {receipt.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between py-1">
              <dt className="text-muted">
                {line.label === 'fee' ? t('pay.receiptFee') : t('pay.receiptThanks')}
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
          {t('pay.receipt', { n: number })} · {date(new Date().toISOString().slice(0, 10))}
        </CardBody>
      </Card>

      <p className="mt-4 text-body font-semibold text-ink">{t('pay.under')}</p>

      <AppFooter />
    </div>
  )
}
