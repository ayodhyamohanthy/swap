import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
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
  const { t } = useI18n()
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
  return (
    <div>
      <h1 className="text-title text-ink">{isGroup ? t('pay.groupTitle') : t('pay.title', { name })}</h1>
      <p className="mt-1 font-head text-section font-bold text-ink">
        {isGroup ? t('pay.pay199') : t('pay.pay99')}
      </p>
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
      <p className="mt-1 text-body font-semibold text-ink">{isGroup ? t('pay.groupUnder') : t('pay.under')}</p>
      {credit > 0 ? (
        <Card className="mt-4 flex items-center gap-3">
          <span className="flex-1">
            <b className="block font-head text-body text-ink">
              {t('pay.haveCredit', { amount: Math.round(credit / 100) })}
            </b>
            <span className="block text-caption text-muted">
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
      <p className="mt-3 font-head text-section font-bold text-ink">
        {t('pay.youPay', { amount: quote.due / 100 })}
      </p>
      {paid && paid.status !== 'failed' ? (
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
            {t('common.continue')}
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
