import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { demoRequest } from '@/lib/demo-swap'
import { receiptNumber, splitReceipt } from '@/lib/payments'

/* Receipt + berth reveal + chat link (docs/04 A11, docs/06 receipts). */
export const Route = createFileRoute('/pay/$requestId/done')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: DoneScreen,
})
function DoneScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const req = demoRequest(requestId)
  const receipt = splitReceipt(9900, 0, req.isGroup)
  const n = receiptNumber(requestId.length * 7919 + 10482)
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.done')}</h1>
      <Card className="mt-4">
        <CardTitle>{t('pay.receipt', { n })}</CardTitle>
        <dl className="mt-2 text-body">
          {receipt.lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between py-1">
              <dt className="text-muted">{l.label === 'fee' ? t('pay.receiptFee') : t('pay.receiptThanks')}</dt>
              <dd className="font-head font-bold text-ink">₹{l.amountPaise / 100}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-head font-bold text-ink">{t('pay.receiptTotal', { amount: 99 })}</dt>
            <dd className="font-head text-title font-bold text-primary">₹99</dd>
          </div>
        </dl>
        <CardBody>{t('pay.berthReveal')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/chat/$id" params={{ id: requestId }}>{t('pay.openChat')}</Link>
      </Button>
      <Button variant="outline" className="mt-2" asChild>
        <Link to="/swaps/$id/summary" params={{ id: requestId }}>{t('summary.title')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
