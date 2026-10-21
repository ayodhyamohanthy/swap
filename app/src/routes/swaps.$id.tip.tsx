import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { gatewayLive } from '@/lib/checkout'
import { rupees, TIP_PRESETS_PAISE } from '@/lib/money'
import { acceptedOffer } from '@/lib/requests'
import { setPaymentStatus, type PaymentRow } from '@/lib/store'
import { beginTip, settleTip, tipGateFor, tipPaymentFor, TipError } from '@/lib/tips'

/* Tips (owner rulings 2026-10-21): after a swap is confirmed done the
   requester may thank the helper with cash — ₹10 / ₹20 / ₹50 — and the helper
   receives 100% of it AS CREDIT, never cash. No split, no refunds, one tip
   per swap. The screen never claims money moved before the capture says so:
   pending is money in flight, failed is a retry, and only `paid` settles the
   helper's credit (settleTip is idempotent on the payment id). */
export const Route = createFileRoute('/swaps/$id/tip')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  component: TipScreen,
})

function SentView({ id, name, payment }: { id: string; name: string; payment: PaymentRow }) {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="mt-2 text-title text-ink">{t('tip.sentTitle')}</h1>
      <Card className="mt-4 border-accent/40 bg-accent-soft">
        <CardBody className="font-semibold text-ink">
          {t('tip.sentBody', { name, amount: rupees(payment.amount_paise) })}
        </CardBody>
        <CardBody>{t('tip.sentNote')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/swaps/$id" params={{ id }}>{t('tip.backToSwap')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}

function TipScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const toast = useToast()
  const [amount, setAmount] = useState<number>(TIP_PRESETS_PAISE[1])
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<PaymentRow | null>(null)
  const [waiting, setWaiting] = useState(false)
  const name = acceptedOffer(id)?.acceptor_name ?? t('common.traveller')
  const gate = tipGateFor(id)
  const existing = tipPaymentFor(id)

  if (sent) return <SentView id={id} name={name} payment={sent} />
  if (gate === 'already_tipped' && existing?.status === 'paid') {
    return <SentView id={id} name={name} payment={existing} />
  }
  if (gate !== 'tippable') {
    return (
      <div>
        <h1 className="mt-2 text-title text-ink">{t('tip.unavailableTitle')}</h1>
        <Card className="mt-4">
          <CardBody>{t('tip.unavailableBody')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id" params={{ id }}>{t('tip.backToSwap')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  function pay(provider: 'razorpay' | 'paypal') {
    if (busy) return
    setBusy(true)
    try {
      const payment = beginTip(id, amount, provider)
      setPaymentStatus(payment.id, 'pending')
      trackEvent('payment_created', { amount_paise: amount })
      if (!gatewayLive()) {
        /* Demo device: no gateway to wait for. Settle locally, exactly like
           the swap status screen's local_demo path — and only a paid payment
           may mint the helper's credit. */
        const paid = setPaymentStatus(payment.id, 'paid', 'local_demo') ?? payment
        settleTip(paid.id)
        setSent(paid)
        return
      }
      /* Live gateway: the webhook settles. Until the capture lands this screen
         says the bank is confirming — it never claims the tip arrived. */
      setWaiting(true)
    } catch (err) {
      toast.show(t(err instanceof TipError && err.code === 'bad_tip_amount' ? 'tip.badAmount' : 'tip.unavailableTitle'))
    } finally {
      setBusy(false)
    }
  }

  if (waiting) {
    return (
      <div>
        <h1 className="mt-2 text-title text-ink">{t('tip.waitingTitle')}</h1>
        <Card className="mt-4">
          <CardBody>{t('tip.waitingBody', { amount: rupees(amount) })}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id" params={{ id }}>{t('tip.backToSwap')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mt-2 text-title text-ink">{t('tip.title', { name })}</h1>
      <Card className="mt-4">
        <CardTitle>{t('tip.choose')}</CardTitle>
        <CardBody>{t('tip.note', { name })}</CardBody>
        <div className="mt-3 flex gap-2">
          {TIP_PRESETS_PAISE.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(preset)}
              className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-body font-semibold ${
                amount === preset
                  ? 'border-primary bg-primary-soft text-ink'
                  : 'border-line bg-surface text-muted'
              }`}
            >
              ₹{rupees(preset)}
            </button>
          ))}
        </div>
      </Card>
      {existing?.status === 'failed' ? (
        <Card className="mt-3">
          <CardBody>{t('tip.failedBody')}</CardBody>
        </Card>
      ) : null}
      <Button className="mt-4" disabled={busy} onClick={() => pay('razorpay')}>
        {t('tip.payUpi', { amount: rupees(amount) })}
      </Button>
      <Button className="mt-2" variant="outline" disabled={busy} onClick={() => pay('paypal')}>
        {t('tip.payPaypal', { amount: rupees(amount) })}
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/swaps/$id" params={{ id }}>{t('tip.noThanks')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
