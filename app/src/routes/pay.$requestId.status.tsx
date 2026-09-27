import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { confirmCaptured, gatewayLive, markFailed, CheckoutError } from '@/lib/checkout'
import { trackEvent } from '@/lib/analytics'
import { usePaymentFor } from '@/lib/use-store'

/* Payment status (docs/04 A10, docs/09, designs 28b/28c): the payment row says
   what happened — pending never claims money moved, failed says it did not.
   The webhook is the source of truth; this screen only asks for it. */
export const Route = createFileRoute('/pay/$requestId/status')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    state: s.state === 'failed' ? ('failed' as const) : ('pending' as const),
  }),
  component: StatusScreen,
})

function StatusScreen() {
  const { requestId } = Route.useParams()
  const { state: requested } = Route.useSearch()
  const { t } = useI18n()
  const navigate = useNavigate()
  const payment = usePaymentFor(requestId)
  const [busy, setBusy] = useState(false)
  const failed = payment?.status === 'failed' || (!payment && requested === 'failed')

  /* One metric per terminal visit (StrictMode-safe via session flag). */
  useEffect(() => {
    if (!failed || typeof window === 'undefined') return
    const key = `seatswap.paid-failed.${requestId}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      /* private mode */
    }
    trackEvent('payment_failed', {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed])

  function check() {
    if (busy || !payment) return
    setBusy(true)
    if (!gatewayLive()) {
      /* Demo device: no gateway to wait for, so settle the swap here. */
      try {
        const settled = confirmCaptured(requestId, 'local_demo')
        /* Only a real lock may show "Payment successful". Money captured with
           no locked swap is not a success screen — it stays here. */
        if (settled.settled) navigate({ to: '/pay/$requestId/done', params: { requestId } })
      } catch (err) {
        /* A payment already recorded as paid must never be flipped to failed. */
        if (err instanceof CheckoutError && payment.status !== 'paid') markFailed(requestId)
      }
      return
    }
    setBusy(false)
  }

  if (failed) {
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.failedTitle')}</h1>
        <Card className="mt-4">
          <CardBody className="font-head text-section font-bold text-ink">
            {t('pay.failedHead')}
          </CardBody>
          <CardBody>{t('pay.failed')}</CardBody>
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild>
              <Link to="/pay/$requestId/method" params={{ requestId }} search={{ useCredit: 1 }}>{t('pay.tryAgain')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/pay/$requestId/method" params={{ requestId }} search={{ useCredit: 1 }}>{t('pay.otherWay')}</Link>
            </Button>
          </div>
        </Card>
        <AppFooter />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.pendingTitle')}</h1>
      <Card className="mt-4">
        <CardTitle>{t('pay.pending')}</CardTitle>
        <CardBody>{t('pay.pendingNote')}</CardBody>
      </Card>
      <Button className="mt-4" disabled={busy || !payment} onClick={check}>
        {t('pay.checkStatus')}
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/pay/$requestId/method" params={{ requestId }} search={{ useCredit: 1 }}>{t('pay.otherWay')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
