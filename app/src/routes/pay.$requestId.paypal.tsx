import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { beginCheckout } from '@/lib/checkout'
import { buildQuote } from '@/lib/payments'
import { isGroupRequestId } from '@/lib/groups'
import { useCreditPaise } from '@/lib/use-store'

/* Screen 25 "Pay with PayPal" (design 28a, docs/06): international travellers
   pay the same ₹99 (₹199 group); PayPal shows its own currency estimate while
   the amount we charge stays INR. */
export const Route = createFileRoute('/pay/$requestId/paypal')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: PaypalScreen,
})
function PaypalScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const credit = useCreditPaise()
  const isGroup = isGroupRequestId(requestId)
  const quote = buildQuote(credit, isGroup)
  const [busy, setBusy] = useState(false)

  async function go() {
    if (busy) return
    setBusy(true)
    try {
      const ticket = beginCheckout(requestId, 'paypal', isGroup)
      navigate(
        ticket.settled
          ? { to: '/pay/$requestId/done', params: { requestId } }
          : { to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } },
      )
    } catch {
      toast.show(t('pay.notYet'))
    } finally {
      setBusy(false)
    }
  }

  if (quote.provider === 'credit') {
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.paypalTitle')}</h1>
        <Card className="mt-4"><CardBody>{t('pay.creditOnly')}</CardBody></Card>
        <Button className="mt-4" disabled={busy} onClick={() => void go()}>{t('common.continue')}</Button>
        <AppFooter />
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.paypalTitle')}</h1>
      <Card className="mt-4 items-center text-center">
        <p className="font-head text-title font-bold text-ink">
          {t('pay.paypalDue', { amount: quote.due / 100 })}
        </p>
      </Card>
      <p className="mt-3 text-center text-body text-muted">{t('pay.paypalOwn')}</p>
      <Button className="mt-4 border-accent bg-accent text-ink" disabled={busy} onClick={() => void go()}>
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
