import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { loadPaypal, loadRazorpay } from '@/lib/pay-sdk'
import { buildQuote } from '@/lib/payments'
import { demoRequest } from '@/lib/demo-swap'
import { useCreditPaise } from '@/lib/use-store'

/* Choose how to pay (docs/04 A10): Razorpay default, PayPal for travellers. */
export const Route = createFileRoute('/pay/$requestId/method')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: MethodScreen,
})
function MethodScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const credit = useCreditPaise()
  const q = buildQuote(credit, demoRequest(requestId).isGroup)
  const [busy, setBusy] = useState(false)
  async function go(provider: 'razorpay' | 'paypal') {
    setBusy(true)
    try {
      if (provider === 'razorpay') await loadRazorpay()
      else await loadPaypal('test')
    } catch { /* SDK CDN offline: status screen still explains pending/failed. */ }
    navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
  }
  if (q.provider === 'credit') {
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.methodTitle')}</h1>
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
      <h1 className="text-title text-ink">{t('pay.methodTitle')}</h1>
      <Card className="mt-4"><CardBody>{t('pay.razorpay')}</CardBody></Card>
      <Button className="mt-3" disabled={busy} onClick={() => go('razorpay')}>
        {t('pay.payNow', { amount: q.due / 100 })}
      </Button>
      <button
        type="button" disabled={busy} onClick={() => go('paypal')}
        className="mt-3 flex min-h-12 w-full items-center justify-center font-semibold text-primary"
      >
        {t('pay.paypalAlt')}
      </button>
      <p className="mt-2 text-center text-caption text-muted">{t('pay.paypalNote', { amount: '1.2' })}</p>
      <AppFooter />
    </div>
  )
}
