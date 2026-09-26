import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { downloadCsv, paymentsToCsv, type AdminPaymentRow } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { FEE_PAISE, THANK_YOU_PAISE, formatRupees } from '@/lib/money'

/* Admin A5 "Payments" (design 18). A payment row only exists once a swap is
   locked. Amounts are integer paise end to end: ₹99 = ₹49 fee + ₹50 credit,
   and the group price is ₹199 for up to 3 swaps. */

export const Route = createFileRoute('/admin/payments')({
  component: AdminPayments,
})

function AdminPayments() {
  const { t } = useI18n()

  /* Honest about state: nothing is captured until a provider webhook confirms
     it, so with no backend connected this list is legitimately empty. */
  const rows: AdminPaymentRow[] = []

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.payments')}</h1>

      <Button
        className="mt-4"
        size="sm"
        onClick={() => downloadCsv('seatswap-payments.csv', paymentsToCsv(rows))}
      >
        {t('admin.csv')}
      </Button>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Card>
          <p className="text-caption text-muted">{t('pay.fee')}</p>
          <p className="mt-1 font-head text-section font-bold text-ink">
            {formatRupees(FEE_PAISE)}
          </p>
        </Card>
        <Card>
          <p className="text-caption text-muted">{t('pay.receiptThanks')}</p>
          <p className="mt-1 font-head text-section font-bold text-ink">
            {formatRupees(THANK_YOU_PAISE)}
          </p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-3"
            >
              <span className="min-w-0">
                <b className="block truncate font-head text-body text-ink">{row.provider}</b>
                <small className="block text-caption text-muted">{row.request_id}</small>
              </span>
              <Pill tone={row.status === 'paid' ? 'primary' : 'neutral'}>{row.status}</Pill>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
