import { Link, createFileRoute } from '@tanstack/react-router'
import { Hourglass } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { usePaymentFor } from '@/lib/use-store'

/* Screen 24 "Waiting for UPI" (design 27b): the requester approved in their
   UPI app; this screen holds while the gateway confirms. No second payment
   from here — only status checks and a way back to other methods. */
export const Route = createFileRoute('/pay/$requestId/upi')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    useCredit: s.useCredit === 0 || s.useCredit === '0' ? 0 : 1,
  }),
  component: UpiScreen,
})
function UpiScreen() {
  const { requestId } = Route.useParams()
  const { useCredit } = Route.useSearch()
  const { t } = useI18n()
  const payment = usePaymentFor(requestId)
  const due = payment ? payment.amount_paise - payment.credit_used_paise : 0
  return (
    <div>
      <div className="mt-2 flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Hourglass aria-hidden className="size-8" />
        </span>
      </div>
      <h1 className="mt-3 text-center text-title text-ink">{t('pay.upiTitle')}</h1>
      <Card className="mt-4 items-center text-center">
        <CardBody className="font-head text-section font-bold text-ink">
          {t('pay.upiBody', { amount: due / 100 })}
        </CardBody>
        <CardBody>{t('pay.upiHold')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/pay/$requestId/status" params={{ requestId }} search={{ state: 'pending' }}>
          {t('pay.checkStatus')}
        </Link>
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/pay/$requestId/method" params={{ requestId }} search={{ useCredit }}>
          {t('pay.upiRetry')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
