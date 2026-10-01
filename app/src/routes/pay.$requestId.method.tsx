import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CreditCard, Smartphone, Wallet } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { PayGate } from '@/components/pay-gate'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { loadRazorpay } from '@/lib/pay-sdk'
import { beginCheckout, payGateFor, CheckoutError } from '@/lib/checkout'
import { acceptedOffer } from '@/lib/requests'
import { buildQuote, usdEstimateFor } from '@/lib/payments'
import { isGroupRequestId } from '@/lib/groups'
import { PayBlocked } from './pay.$requestId'
import { useCreditPaise } from '@/lib/use-store'

/* Choose how to pay (docs/04 A10, design 27a): Razorpay is the rail for
   EVERYONE, UPI apps on top, and PayPal is the fallback a passenger from abroad
   picks deliberately (rule 9, docs/06 "Choosing the provider"). Tapping a method
   opens the real gateway when keys exist and otherwise leaves the payment
   pending for the status screen — it never claims a payment happened. */
export const Route = createFileRoute('/pay/$requestId/method')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    useCredit: s.useCredit === 0 || s.useCredit === '0' ? 0 : 1,
  }),
  component: MethodScreen,
})

/** UPI methods wait for approval in the app; cards and net banking do not. */
type MethodKey = 'pay.otherUpi' | 'pay.debitCard' | 'pay.netBanking'
type Method = { label: string; i18nKey?: MethodKey; Icon: typeof Wallet; waits: boolean }
const UPI_APPS: Method[] = [
  { label: 'GPay', Icon: Wallet, waits: true },
  { label: 'PhonePe', Icon: Wallet, waits: true },
  { label: 'Paytm', Icon: Wallet, waits: true },
]
const OTHERS: Method[] = [
  { label: 'pay.otherUpi', i18nKey: 'pay.otherUpi', Icon: Smartphone, waits: true },
  { label: 'pay.debitCard', i18nKey: 'pay.debitCard', Icon: CreditCard, waits: false },
  { label: 'pay.netBanking', i18nKey: 'pay.netBanking', Icon: Wallet, waits: false },
]

function MethodScreen() {
  const { requestId } = Route.useParams()
  const { useCredit } = Route.useSearch()
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const credit = useCreditPaise()
  const isGroup = isGroupRequestId(requestId)
  const quote = buildQuote(useCredit === 1 ? credit : 0, isGroup)
  const [busy, setBusy] = useState(false)
  const name = acceptedOffer(requestId)?.acceptor_name ?? t('common.traveller')
  /* The estimate must describe the SAME amount the sentence names. This read
     `usdTenthsFor(isGroup ? 19900 : PRICE_PAISE)` — the FULL price — while
     `paypalNote` quotes `quote.due`, so a credit-covered order rendered
     "PayPal shows about US$1.2 as an estimate. You are charged ₹49.": one
     sentence, two different amounts, with the dollar figure describing the one
     the payer is not paying. `usdEstimateFor` also floors the tenths, because
     this screen is reached with `due = 0` (fully credit-covered) and with small
     remainders the rate hint rounds to zero — and `formatUsdTenths` throws on
     zero, so the estimate used to take the screen down mid-render. */
  const usd = usdEstimateFor(quote.due)

  async function pay(provider: 'razorpay' | 'paypal', method: Method) {
    if (busy) return
    setBusy(true)
    /* PayPal leaves the app to authorise, so it gets its own screen (design
       28a) which redirects out and captures the order on the way back. */
    if (provider === 'paypal') {
      setBusy(false)
      navigate({ to: '/pay/$requestId/paypal', params: { requestId }, search: { useCredit } })
      return
    }
    /* The SDK is loaded first so a phone with no network finds out here, before
       any payment row exists. */
    try {
      if (provider === 'razorpay') await loadRazorpay()
    } catch {
      /* CDN blocked: the local checkout still records the attempt honestly. */
    }
    try {
      const ticket = beginCheckout(requestId, provider, isGroup, useCredit === 1)
      if (ticket.settled) {
        navigate({ to: '/pay/$requestId/done', params: { requestId } })
        return
      }
      if (method.waits) navigate({ to: '/pay/$requestId/upi', params: { requestId }, search: { useCredit } })
      else navigate({ to: '/pay/$requestId/status', params: { requestId }, search: { state: 'pending' } })
    } catch (err) {
      toast.show(t(err instanceof CheckoutError && err.code === 'not_awaiting_payment' ? 'pay.notYet' : 'pay.alreadyPaid'))
    } finally {
      setBusy(false)
    }
  }

  /* Rule 2, on the child screen rather than only in the lib: a settled swap
     must not render a working list of payment methods. */
  const gate = payGateFor(requestId)
  if (gate !== 'payable') return <PayBlocked requestId={requestId} gate={gate} />

  if (quote.provider === 'credit') {
    /* Fully covered: no gateway call at all (docs/06). */
    return (
      <div>
        <h1 className="text-title text-ink">{t('pay.methodTitle')}</h1>
        <Card className="mt-4">
          <CardBody>{t('pay.creditOnly')}</CardBody>
        </Card>
        <Button className="mt-4" disabled={busy} onClick={() => void pay('razorpay', UPI_APPS[0])}>
          {t('common.continue')}
        </Button>
        <AppFooter />
      </div>
    )
  }

  return (
    <PayGate requestId={requestId}>
    <div>
      <h1 className="text-title text-ink">{t('pay.methodTitle')}</h1>
      <Card className="mt-4">
        <CardTitle>{isGroup ? t('pay.groupTitle') : `${t('pay.title', { name })}`} · {isGroup ? t('pay.pay199') : t('pay.pay99')}</CardTitle>
        {/* One statement of the amount due, not two. `pay.due` is already
            "To pay ₹{amount}", so the `· {formatRupees(quote.due)}` that used to
            follow it rendered the same figure twice — "To pay ₹49 · ₹49" — from
            two different formatters of one number. Design 27a draws no body line
            at all; this keeps the useful clarification and drops the echo. */}
        <CardBody>{t('pay.due', { amount: quote.due / 100 })}</CardBody>
      </Card>

      {/* `text-note`, not the 12px step: these two labels name the gateway the
          payer is about to hand money to (Razorpay primary for all, PayPal
          fallback for international), and docs/07 §Responsive floors copy a
          passenger reads to decide at 14px.

          `pay.razorpay`, NOT the old `pay.inIndia`: a heading that says "in
          India" over the card rail is precisely what told a passenger from
          abroad that the list above was not for them. The section is not
          country-scoped (rule 9, build-plan item 7), so the label must not be
          either. */}
      <p className="mt-5 text-note font-semibold uppercase tracking-wide text-muted">
        {t('pay.razorpay')}
      </p>
      <Card className="mt-1">
        {[...UPI_APPS, ...OTHERS].map((method) => (
          <button
            key={method.label}
            type="button"
            disabled={busy}
            onClick={() => void pay('razorpay', method)}
            className="tap flex min-h-12 w-full items-center gap-3 border-b border-line px-1 text-left last:border-0 disabled:opacity-60"
          >
            <method.Icon aria-hidden className="size-5 text-primary" />
            <span className="font-head font-bold text-ink">
              {method.i18nKey ? t(method.i18nKey) : method.label}
            </span>
          </button>
        ))}
      </Card>

      <p className="mt-5 text-note font-semibold uppercase tracking-wide text-muted">
        {t('pay.intl')}
      </p>
      <Card className="mt-1">
        <CardBody>
          {/* Rule 9's mandated label names PayPal here, so the correction comes
              FIRST and above the button: a card from abroad works in the list
              above, and PayPal is the fallback the passenger chooses. Putting
              this line under the button left the section reading "international
              ⇒ PayPal", which is the framing item 7 removes. */}
          <p className="text-note text-muted">{t('pay.intlNote')}</p>
          <Button
            className="mt-3 w-full border-accent bg-accent text-ink"
            variant="outline"
            disabled={busy}
            onClick={() => void pay('paypal', { label: 'paypal', Icon: Wallet, waits: false })}
          >
            {t('pay.payPal')}
          </Button>
          <p className="mt-2 text-note text-muted">{t('pay.paypalNote', { amount: quote.due / 100, usd })}</p>
        </CardBody>
      </Card>

      <p className="mt-3 text-center text-body font-semibold text-ink">{t('pay.under')}</p>
      <AppFooter />
    </div>
    </PayGate>
  )
}
