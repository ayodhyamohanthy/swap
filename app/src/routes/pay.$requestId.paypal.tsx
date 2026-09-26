import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { loadPaypal } from '@/lib/pay-sdk'
import { buildQuote } from '@/lib/payments'
import { demoRequest } from '@/lib/demo-swap'
import { useCreditPaise } from '@/lib/use-store'

/* Screen 25 "Pay with PayPal" (design 28a, docs/06): international
   travellers pay the same ₹99; PayPal shows its own currency estimate. */
export const Route = createFileRoute('/pay/$requestId/paypal')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: PaypalScreen,
})
function PaypalScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const credit = useCreditPaise()
  const q = buildQuote(credit, demoRequest(requestId).isGroup)
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      await loadPaypal('test')
    } catch { /* SDK CDN offline: status screen still explains pending/failed. */ }
    navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
  }
  if (q.provider === 'credit') {
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.paypalTitle')}</h1>
        <Card className="mt-4"><CardBody>{t('pay.creditOnly')}</CardBody></Card>
        <Button className="mt-4" asChild>
          <Link to="/pay/$requestId/done" params={{ requestId }}>{t('common.continue')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.paypalTitle')}</h1>
      <Card className="mt-4 items-center text-center">
        <p className="font-head text-title font-bold text-ink">
          {t('pay.paypalDue', { amount: q.due / 100 })}
        </p>
      </Card>
      <p className="mt-3 text-center text-body text-muted">{t('pay.paypalOwn')}</p>
      <Button className="mt-4 border-accent bg-accent text-ink" disabled={busy} onClick={go}>
        {t('pay.paypalGo')}
      </Button>
      <p className="mt-2 text-center text-caption text-muted">{t('pay.paypalFor')}</p>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/pay/$requestId/method" params={{ requestId }}>
          {t('pay.otherWay')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
