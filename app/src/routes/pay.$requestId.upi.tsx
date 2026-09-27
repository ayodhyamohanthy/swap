import { Link, createFileRoute } from '@tanstack/react-router'
import { Hourglass } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { buildQuote } from '@/lib/payments'
import { demoRequest } from '@/lib/demo-swap'
import { useCreditPaise } from '@/lib/use-store'

/* Screen 24 "Waiting for UPI" (design 27b): the requester approved in their
   UPI app; this screen holds while the gateway confirms. No second payment
   from here — only status checks and a way back to other methods. */
export const Route = createFileRoute('/pay/$requestId/upi')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: UpiScreen,
})
function UpiScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const credit = useCreditPaise()
  const q = buildQuote(credit, demoRequest(requestId).isGroup)
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
          {t('pay.upiBody', { amount: q.due / 100 })}
        </CardBody>
        <CardBody>{t('pay.upiHold')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/pay/$requestId/status" params={{ requestId }} search={{ state: 'pending' }}>
          {t('pay.checkStatus')}
        </Link>
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/pay/$requestId/method" params={{ requestId }}>
          {t('pay.upiRetry')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
