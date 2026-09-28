import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CreditCard, Smartphone, Wallet } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { formatUsdTenths, PRICE_PAISE, usdTenthsFor } from '@/lib/money'
import { loadRazorpay } from '@/lib/pay-sdk'
import { beginCheckout, payGateFor, CheckoutError } from '@/lib/checkout'
import { acceptedOffer } from '@/lib/requests'
import { buildQuote } from '@/lib/payments'
import { formatRupees } from '@/lib/money'
import { isGroupRequestId } from '@/lib/groups'
import { PayBlocked } from './pay.$requestId'
import { useCreditPaise } from '@/lib/use-store'

/* Choose how to pay (docs/04 A10, design 27a): Razorpay first with UPI apps on
   top, PayPal for international travellers. Tapping a method opens the real
   gateway when keys exist and otherwise leaves the payment pending for the
   status screen — it never claims a payment happened. */
export const Route = createFileRoute('/pay/$requestId/method')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
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
  /* Same estimate helper as the PayPal screen: quote.due is the INR charge,
     quote.provider === 'credit' means nothing is charged at all. */
  const usd = formatUsdTenths(usdTenthsFor(isGroup ? 19900 : PRICE_PAISE))

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
    <div>
      <h1 className="text-title text-ink">{t('pay.methodTitle')}</h1>
      <Card className="mt-4">
        <CardTitle>{isGroup ? t('pay.groupTitle') : `${t('pay.title', { name })}`} · {isGroup ? t('pay.pay199') : t('pay.pay99')}</CardTitle>
        <CardBody>{t('pay.due', { amount: quote.due / 100 })} · {formatRupees(quote.due)}</CardBody>
      </Card>

      <p className="mt-5 text-caption font-semibold uppercase tracking-wide text-muted">{t('pay.inIndia')}</p>
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

      <p className="mt-5 text-caption font-semibold uppercase tracking-wide text-muted">{t('pay.intl')}</p>
      <Card className="mt-1">
        <CardBody>
          <Button
            className="w-full border-accent bg-accent text-ink"
            variant="outline"
            disabled={busy}
            onClick={() => void pay('paypal', { label: 'paypal', Icon: Wallet, waits: false })}
          >
            {t('pay.payPal')}
          </Button>
          <p className="mt-2 text-caption text-muted">{t('pay.paypalNote', { amount: quote.due / 100, usd })}</p>
        </CardBody>
      </Card>

      <p className="mt-3 text-center text-body font-semibold text-ink">{t('pay.under')}</p>
      <AppFooter />
    </div>
  )
}
