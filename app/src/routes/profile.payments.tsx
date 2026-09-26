import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { Coins, Receipt } from 'lucide-react'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState } from '@/lib/use-store'

/* Screen 58 "Payments & receipts" (design 29a). Every row is an integer-paise
   `wallet_tx` row: a payment, credit earned, or ₹99 moved to credit when a swap
   did not happen (rules 3-6). Credit is never shown as cash and never as a
   withdrawal. Sending requests costs nothing, so an empty list is normal. */

export const Route = createFileRoute('/profile/payments')({
  component: PaymentsLayout,
})

/** Layout: the list renders at the index route; /$id (receipt) renders here. */
function PaymentsLayout() {
  return <Outlet />
}

function kindLabel(kind: string): 'payments.paid' | 'payments.toCredit' | 'profile.credit' {
  if (kind === 'used' || kind === 'expired') return 'profile.credit'
  if (kind === 'acceptor_credit' || kind === 'swap_to_credit') return 'payments.toCredit'
  return 'payments.paid'
}

export function PaymentsScreen() {
  const { t, date } = useI18n()
  const { wallet } = useAppState()

  const rows = [...wallet].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const totalPaise = rows.reduce((sum, row) => sum + row.amount_paise, 0)

  return (
    <div>
      <h1 className="text-title text-ink">{t('payments.title')}</h1>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('payments.empty')}</CardBody>
          <Button className="mt-3" variant="outline" asChild>
            <Link to="/swaps">{t('nav.swaps')}</Link>
          </Button>
        </Card>
      ) : (
        <>
          <Card className="mt-4 border-primary/30 bg-wash">
            <span className="flex items-center gap-2">
              <Coins aria-hidden className="size-5 text-accent" />
              <b className="font-head text-section text-ink">{t('profile.credit')}</b>
            </span>
            <p className="mt-1 font-head text-title text-primary">{formatRupees(totalPaise)}</p>
            <CardBody className="text-ink">{t('profile.creditBody')}</CardBody>
          </Card>

          <section className="mt-4 space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                  <Receipt aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block font-head text-body text-ink">
                    {t(kindLabel(row.kind))}
                  </b>
                  <small className="block text-caption text-muted">
                    {date(row.created_at.slice(0, 10))}
                  </small>
                </span>
                <span className="text-right">
                  <b className="block font-head text-body text-ink">
                    {formatRupees(row.amount_paise)}
                  </b>
                  {row.ref_request_id ? (
                    <Pill tone="neutral">
                      {t('payments.receipt', {
                        n: row.ref_request_id.slice(-5).toUpperCase(),
                      })}
                    </Pill>
                  ) : null}
                </span>
              </div>
            ))}
          </section>

          <p className="mt-4 text-caption text-muted">{t('payments.demo')}</p>
        </>
      )}

      <AppFooter />
    </div>
  )
}
