import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight } from 'lucide-react'
import { useState } from 'react'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'
import { useToast } from '@/components/ui/toast'
import { acceptedOffer, getRequest, groupLockedCount } from '@/lib/requests'
import { lockCoveredRequest, payGateFor, CheckoutError } from '@/lib/checkout'
import { buildQuote, priceFor } from '@/lib/payments'
import { FEE_PAISE, GROUP_MAX_SWAPS, THANK_YOU_PAISE, formatRupees } from '@/lib/money'
import { useCreditPaise, usePaymentFor } from '@/lib/use-store'
import { getGroup, isGroupRequestId } from '@/lib/groups'
import { getTrip } from '@/lib/store'

/* Pay screen (docs/04 A9): breakdown 49+50, credit line if balance>0,
   lock note, No-swap-to-credit. Sending requests is free; pay after accept. */
export const Route = createFileRoute('/pay/$requestId')({
  component: PayLayout,
})

/** Layout: child screens (method / status / done) render here. */
function PayLayout() {
  return <Outlet />
}

/** Rule 2's refusal, as a screen. Every route under the `/pay/$requestId`
    layout renders this instead of a live payment UI when `payGateFor` says the
    id is not payable — the index screen had this branch inline, so the child
    screens (`/method`, `/paypal`, `/upi`, `/status`) rendered a working
    "Pay ₹99" for a swap that was already settled and only refused on tap.
    Never a dead end: always a way back to the request, swap or group. */
export function PayBlocked({
  requestId,
  gate,
}: {
  requestId: string
  gate: 'paid' | 'not-yet' | 'missing'
}) {
  const { t } = useI18n()
  if (isGroupRequestId(requestId)) {
    const group = getGroup(requestId)
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('pay.groupTitle')}</CardTitle>
          <CardBody>{gate === 'paid' ? t('groups.paid') : t('groups.none')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          {gate === 'paid' && group ? (
            <Link to="/groups/$id" params={{ id: requestId }}>
              {t('common.continue')}
            </Link>
          ) : (
            <Link to="/">{t('common.continue')}</Link>
          )}
        </Button>
        <AppFooter />
      </div>
    )
  }
  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{t('pay.title', { name: acceptedOffer(requestId)?.acceptor_name ?? '' })}</CardTitle>
        <CardBody>{gate === 'paid' ? t('pay.alreadyPaid') : t('pay.notYet')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link
          to={gate === 'paid' ? '/swaps/$id' : '/request/$id'}
          params={{ id: requestId }}
        >
          {t('common.continue')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}

export function PayScreen() {
  const { requestId } = Route.useParams()
  const { t, type } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const credit = useCreditPaise()
  const paid = usePaymentFor(requestId)
  const request = getRequest(requestId)
  const gate = payGateFor(requestId)

  /* A member swap covered by a paid group trip locks with no extra charge
     (docs/04 C) — unless the group already covers GROUP_MAX_SWAPS, in which
     case this swap pays the normal per-request ₹99 below. */
  const covering =
    !isGroupRequestId(requestId) && request?.group_id
      ? getGroup(request.group_id)
      : undefined
  const covered =
    gate === 'payable' && covering?.paid && groupLockedCount(covering.id) < GROUP_MAX_SWAPS
  if (covered && covering) {
    const lockIt = () => {
      try {
        const locked = lockCoveredRequest(requestId)
        navigate({ to: '/swaps/$id', params: { id: locked.id } })
      } catch (err) {
        toast.show(t(err instanceof CheckoutError ? 'pay.coveredCap' : 'pay.notYet'))
      }
    }
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('pay.coveredTitle')}</CardTitle>
          <CardBody>{t('pay.coveredBody')}</CardBody>
        </Card>
        <Button className="mt-4" onClick={lockIt}>
          {t('pay.lockCovered')}
        </Button>
        <AppFooter />
      </div>
    )
  }

  /* Rule 2: there is nothing to pay before an acceptance, and nothing twice
     after a payment. */
  if (gate !== 'payable') return <PayBlocked requestId={requestId} gate={gate} />

  const offer = acceptedOffer(requestId)
  const name = offer?.acceptor_name ?? t('common.traveller')
  const isGroup = isGroupRequestId(requestId)
  /* Design 03c: the traveller chooses whether credit lowers this payment. */
  const [useCredit, setUseCredit] = useState(true)
  const quote = buildQuote(useCredit ? credit : 0, isGroup)
  /* Design 3c leads with the acceptor's face and what changes hands. Only the
     berth TYPE is shown — the number is still hidden until payment (rule 13) —
     and the avatar is their initial, which is all we are ever allowed to keep. */
  const mine = request ? getTrip(request.trip_id)?.passengers[0] : undefined
  const give = mine?.berth_type
  const get = offer?.acceptor_berth_type
  const trade = !isGroup && give && get
  return (
    <div>
      {offer && !isGroup ? (
        <div className="flex justify-center">
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-full bg-primary font-head text-title font-bold text-white"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      ) : null}

      <h1 className="text-title text-ink">{isGroup ? t('pay.groupTitle') : t('pay.title', { name })}</h1>
      {trade ? (
        <p className="mt-1 text-body text-muted">{t('pay.confirmSub')}</p>
      ) : (
        <p className="mt-1 font-head text-section font-bold text-ink">
          {isGroup ? t('pay.pay199') : t('pay.pay99')}
        </p>
      )}

      {/* Design 3c: "You give ⇄ You get", the one line that says what the swap
          actually is, before any money moves. */}
      {trade ? (
        <Card className="mt-4 flex items-center gap-3">
          <span className="flex-1 text-center">
            <small className="block text-caption text-muted">{t('pay.youGive')}</small>
            <b className="block font-head text-body text-ink">{type(give)}</b>
          </span>
          <ArrowLeftRight aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="flex-1 text-center">
            <small className="block text-caption text-muted">{t('pay.youGet')}</small>
            <b className="block font-head text-body text-ink">{type(get)}</b>
          </span>
        </Card>
      ) : null}

      <Card className="mt-4">
        <dl className="text-body">
          {isGroup ? (
            <Row label={t('pay.groupCover')} value={formatRupees(priceFor(true))} />
          ) : (
            <>
              <Row label={t('pay.fee')} value={formatRupees(FEE_PAISE)} />
              <Row label={t('pay.thankYou', { name })} value={formatRupees(THANK_YOU_PAISE)} />
            </>
          )}
          {quote.creditUsed > 0 ? (
            <Row
              label={t('pay.creditLine', { amount: quote.creditUsed / 100 })}
              value={`−${formatRupees(quote.creditUsed)}`}
              accent
            />
          ) : null}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-head font-bold text-ink">{t('pay.due', { amount: quote.due / 100 })}</dt>
            <dd className="font-head text-title font-bold text-primary">{formatRupees(quote.due)}</dd>
          </div>
        </dl>
      </Card>
      <p className="mt-3 text-body text-muted">{isGroup ? t('pay.groupLock') : t('pay.lock')}</p>
      {credit > 0 ? (
        <Card className="mt-4 flex items-center gap-3">
          <span className="flex-1">
            <b className="block font-head text-body text-ink">
              {t('pay.haveCredit', { amount: Math.round(credit / 100) })}
            </b>
            <span className="block text-note text-muted">
              {t('pay.reduceBy', { amount: quote.creditUsed / 100 })}
            </span>
          </span>
          <Switch
            checked={useCredit}
            aria-label={t('pay.haveCredit', { amount: Math.round(credit / 100) })}
            onCheckedChange={setUseCredit}
          />
        </Card>
      ) : null}
      {/* Design 3c ends on one washed card: the amount, and the promise that
          the money is never lost if the swap doesn't happen (rule 6). */}
      <div className="mt-4 flex items-start justify-between gap-3 rounded-card bg-wash p-4">
        <b className="font-head text-section font-bold text-ink">
          {t('pay.youPay', { amount: quote.due / 100 })}
        </b>
        <span className="text-note text-ink">
          {isGroup ? t('pay.groupUnder') : t('pay.under')}
        </span>
      </div>
      {/* Design 03c ends on "Pay with UPI" — the action, not a status page.
          Reuses `pay.payNow` ("Pay ₹49") rather than a new key: the design
          names the instrument because its method screen is one tap away, and
          the amount is the more useful of the two on a screen that has just
          shown a credit discount change.

          The branch used to be `paid && paid.status !== 'failed'`, which sent
          the traveller to a waiting screen after a payment that had only been
          *created*. `startPayment` writes a `created` row the moment checkout
          opens, before a byte reaches Razorpay, so a first-time payer who
          backed out of the method screen, or whose gateway handoff was killed,
          landed on "Your bank is still confirming ₹99 / Please don't pay again"
          for a payment the bank had never heard of. The instruction not to pay
          again is the right instinct applied to the wrong state: the honest
          thing there is to let them pay.

          `pending` is the only state where money is genuinely in flight, so it
          is the only one that earns the status screen. `created` and `failed`
          both go back to the method list. */}
      {paid?.status === 'pending' ? (
        <Button className="mt-4" asChild>
          <Link to="/pay/$requestId/status" params={{ requestId }} search={{ state: 'pending' }}>
            {t('pay.checkStatus')}
          </Link>
        </Button>
      ) : (
        <Button className="mt-4" asChild>
          <Link
            to="/pay/$requestId/method" params={{ requestId }}
            search={{ useCredit: useCredit ? 1 : 0 }}
          >
            {t('pay.payNow', { amount: quote.due / 100 })}
          </Link>
        </Button>
      )}
      <AppFooter />
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <dt className="text-muted">{label}</dt>
      <dd className={accent ? 'font-head font-bold text-accent' : 'font-head font-bold text-ink'}>{value}</dd>
    </div>
  )
}
