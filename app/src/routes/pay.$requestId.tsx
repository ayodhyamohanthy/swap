import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { demoRequest } from '@/lib/demo-swap'
import { buildQuote } from '@/lib/payments'
import { useCreditPaise } from '@/lib/use-store'

/* Pay screen (docs/04 A9): breakdown 49+50, credit line if balance>0,
   lock note, No-swap-to-credit. Sending requests is free; pay after accept. */
export const Route = createFileRoute('/pay/$requestId')({
  component: PayLayout,
})

/** Layout: child screens (method / status / done) render here. */
function PayLayout() {
  return <Outlet />
}
export function PayScreen() {
  const { requestId } = Route.useParams()
  const { t } = useI18n()
  const req = demoRequest(requestId)
  const credit = useCreditPaise()
  const q = buildQuote(credit, req.isGroup)
  return (
    <div>
      <h1 className="text-title text-ink">{t('pay.title', { name: req.acceptorName })}</h1>
      <Card className="mt-4">
        <dl className="text-body">
          <div className="flex items-center justify-between py-1">
            <dt className="text-muted">{t('pay.fee')}</dt>
            <dd className="font-head font-bold text-ink">₹49</dd>
          </div>
          <div className="flex items-center justify-between py-1">
            <dt className="text-muted">{t('pay.thankYou', { name: req.acceptorName })}</dt>
            <dd className="font-head font-bold text-ink">₹50</dd>
          </div>
          {q.creditUsed > 0 ? (
            <div className="flex items-center justify-between py-1">
              <dt className="text-muted">{t('pay.creditLine', { amount: q.creditUsed / 100 })}</dt>
              <dd className="font-head font-bold text-primary">−₹{q.creditUsed / 100}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-head font-bold text-ink">{t('pay.due', { amount: q.due / 100 })}</dt>
            <dd className="font-head text-title font-bold text-primary">₹{q.due / 100}</dd>
          </div>
        </dl>
      </Card>
      <p className="mt-3 text-body text-muted">{t('pay.lock')}</p>
      <p className="mt-1 text-body font-semibold text-ink">{t('pay.under')}</p>
      <Button className="mt-4" asChild>
        <Link to="/pay/$requestId/method" params={{ requestId }}>{t('common.continue')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
