import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, type RequestStatus } from '@/lib/requests'
import { buildQuote, priceFor } from '@/lib/payments'
import { formatRupees } from '@/lib/money'
import { useCreditPaise, usePaymentFor } from '@/lib/use-store'
import { isGroupRequestId } from '@/lib/groups'

/* Pay screen (docs/04 A9): breakdown 49+50, credit line if balance>0,
   lock note, No-swap-to-credit. Sending requests is free; pay after accept. */
export const Route = createFileRoute('/pay/$requestId')({
  component: PayLayout,
})

/** Layout: child screens (method / status / done) render here. */
function PayLayout() {
  return <Outlet />
}

/** Where a request stands against rule 2 (pay only after an acceptance). */
export function payGate(status: RequestStatus | undefined): 'payable' | 'paid' | 'not-yet' | 'missing' {
  if (!status) return 'missing'
  if (status === 'accepted_awaiting_payment') return 'payable'
  if (status === 'locked' || status === 'confirmed' || status === 'disputed') return 'paid'
  return 'not-yet'
}

export function PayScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const credit = useCreditPaise()
  const paid = usePaymentFor(requestId)
  const request = getRequest(requestId)
  const gate = payGate(request?.status)

  if (gate !== 'payable') {
    /* Rule 2: there is nothing to pay before an acceptance, and nothing twice
       after a payment. Never a dead end — always a way back to the request. */
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

  const offer = acceptedOffer(requestId)
  const name = offer?.acceptor_name ?? t('common.traveller')
  const isGroup = isGroupRequestId(requestId)
  const quote = buildQuote(credit, isGroup)
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.title', { name })}</h1>
      <p className="mt-1 font-head text-section font-bold text-ink">
        {isGroup ? t('pay.pay199') : t('pay.pay99')}
      </p>
      <Card className="mt-4">
        <dl className="text-body">
          {isGroup ? (
            <Row label={t('pay.groupCover')} value={formatRupees(priceFor(true))} />
          ) : (
            <>
              <Row label={t('pay.fee')} value="₹49" />
              <Row label={t('pay.thankYou', { name })} value="₹50" />
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
      <p className="mt-3 text-body text-muted">{t('pay.lock')}</p>
      <p className="mt-1 text-body font-semibold text-ink">{t('pay.under')}</p>
      {paid && paid.status !== 'failed' ? (
        <Button className="mt-4" asChild>
          <Link to="/pay/$requestId/status" params={{ requestId }} search={{ state: 'pending' }}>
            {t('pay.checkStatus')}
          </Link>
        </Button>
      ) : (
        <Button className="mt-4" asChild>
          <Link to="/pay/$requestId/method" params={{ requestId }}>{t('common.continue')}</Link>
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
