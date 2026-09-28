import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { formatUsdTenths, usdTenthsFor } from '@/lib/money'
import { buildQuote } from '@/lib/payments'
import {
  beginCheckout,
  confirmCaptured,
  gatewayLive,
  markFailed,
  payGateFor,
  CheckoutError,
} from '@/lib/checkout'
import { isGroupRequestId } from '@/lib/groups'
import { useCreditPaise, usePaymentFor } from '@/lib/use-store'
import { capturePaypalOrder, createPaypalOrder } from '@/server/webhooks'
import { PayBlocked } from './pay.$requestId'

/* Screen 25 "Pay with PayPal" (docs/05, docs/06 PayPal, design 28a): the one
   international-traveller path. This screen does two jobs on a single route —
   before the hop it shows the amount PayPal is about to take, after the hop
   (PayPal returns with ?token=) it captures and settles the payment.

   Nothing here decides that money moved: the capture response does, and only
   'paid' locks the swap (rule 2). Without a live gateway the button goes to the
   status screen instead, so a demo device can never claim a real payment. */
export const Route = createFileRoute('/pay/$requestId/paypal')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    useCredit: s.useCredit === 0 || s.useCredit === '0' ? 0 : 1,
    /* PayPal appends token=<order id>&PayerID=<id> on the way back. Spread in
       only when present so a normal link from /method needs just useCredit. */
    ...(typeof s.token === 'string' ? { token: s.token } : {}),
    ...(typeof s.PayerID === 'string' ? { payerId: s.PayerID } : {}),
  }),
  component: PaypalScreen,
})

function PaypalScreen() {
  const { requestId } = Route.useParams()
  const { useCredit, token } = Route.useSearch()
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const credit = useCreditPaise()
  const payment = usePaymentFor(requestId)
  const isGroup = isGroupRequestId(requestId)
  const [busy, setBusy] = useState(false)
  /* One capture per order: the webhook may land first, and React re-runs this
     effect in StrictMode. */
  const captured = useRef<string | null>(null)

  const quote = buildQuote(useCredit === 1 ? credit : 0, isGroup)
  /* Card total is the gateway's own number, so a credit-covered order shows the
     reduced amount rather than the full price. */
  const charged = payment ? payment.amount_paise - payment.credit_used_paise : quote.due
  /* The USD figure is an estimate only (docs/06) — the charge is always the
     INR amount, so a partly credit-covered order estimates on what is left. */
  const usd = formatUsdTenths(usdTenthsFor(Math.max(charged, 1)))

  /* Return leg: PayPal sent the payer back with an order id to capture. */
  useEffect(() => {
    if (!token || !gatewayLive()) return
    if (captured.current === token) return
    captured.current = token
    let cancelled = false
    void (async () => {
      try {
        const capture = await capturePaypalOrder({ data: { orderId: token, requestId, isGroup } })
        if (cancelled) return
        if (capture.status === 'paid') {
          confirmCaptured(requestId, capture.provider_ref ?? undefined)
          navigate({ to: '/pay/$requestId/done', params: { requestId } })
        } else if (capture.status === 'failed') {
          /* Rule 6: no money, no credit spent, the swap stays open. */
          try {
            markFailed(requestId)
          } catch {
            /* no payment row to fail */
          }
          navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'failed' } })
        } else {
          navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
        }
      } catch {
        if (cancelled) return
        /* A capture error is not a failed payment — the webhook may still
           confirm it, so the traveller lands on Check status, never on a lie. */
        navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, requestId])

  /* Rule 2. Placed after the capture effect on purpose: the return leg from
     PayPal still has to settle an order it already authorised, and only the
     rendered "Pay with PayPal" button is withdrawn once the swap is paid. */
  const gate = payGateFor(requestId)

  async function go() {
    if (busy) return
    setBusy(true)
    try {
      if (!gatewayLive()) {
        /* No PayPal keys on this device: book the attempt locally and leave it
           honestly pending so the status screen can settle it, exactly as the
           other methods do. */
        const offline = beginCheckout(requestId, 'paypal', isGroup, useCredit === 1)
        if (offline.settled) {
          navigate({ to: '/pay/$requestId/done', params: { requestId } })
          return
        }
        navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
        return
      }
      const origin = window.location.origin
      /* The SERVER decides the amount and how much credit covers it, so the two
         can never disagree. The local payment row must then carry that same
         figure, or the client spends credit the payer was never actually
         charged for. */
      const order = await createPaypalOrder({
        data: {
          requestId,
          isGroup,
          useCredit: useCredit === 1,
          returnUrl: `${origin}/pay/${encodeURIComponent(requestId)}/paypal`,
          cancelUrl: `${origin}/pay/${encodeURIComponent(requestId)}/method`,
        },
      })
      const ticket = beginCheckout(requestId, 'paypal', isGroup, false, order.credit_used_paise)
      if (ticket.settled) {
        navigate({ to: '/pay/$requestId/done', params: { requestId } })
        return
      }
      if (order.approval_url) {
        window.location.href = order.approval_url
        return
      }
      /* PayPal returned no payer-action link: the order exists but nobody can
         authorise it, so this stays pending rather than silently succeeding. */
      navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
    } catch (err) {
      if (err instanceof CheckoutError && err.code === 'not_awaiting_payment') {
        toast.show(t('pay.notYet'))
        navigate({ to: '/request/$id', params: { id: requestId } })
        return
      }
      if (err instanceof CheckoutError && err.code === 'already_paid') {
        toast.show(t('pay.alreadyPaid'))
        navigate({ to: '/swaps/$id', params: { id: requestId } })
        return
      }
      toast.show(t('pay.pending'))
      navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
    } finally {
      setBusy(false)
    }
  }

  if (gate !== 'payable') return <PayBlocked requestId={requestId} gate={gate} />

  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.paypalTitle')}</h1>
      <Card className="mt-4">
        <span className="font-head text-title font-bold text-ink">
          {t('pay.paypalDue', { amount: charged / 100, usd })}
        </span>
      </Card>
      <p className="mt-4 text-body text-muted">{t('pay.paypalOwn')}</p>
      <div className="mt-8">
        <Button
          className="border-accent bg-accent text-ink"
          variant="outline"
          disabled={busy}
          onClick={() => void go()}
        >
          {t('pay.paypalGo')}
        </Button>
        <p className="mt-2 text-center text-caption text-muted">{t('pay.paypalFor')}</p>
      </div>
      <AppFooter />
    </div>
  )
}
