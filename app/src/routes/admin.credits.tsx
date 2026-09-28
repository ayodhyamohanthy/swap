import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Coins } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/pill'
import { adminNoticeKey, creditSummary, creditsToCsv, downloadCsv, runAdminAction, type AdminCreditRow } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState } from '@/lib/use-store'

/* Admin A6 "Credits" (design 24). Credit is never cash and is never sent back
   to a bank (rules 4 and 6) — the only way out is spending it on a future swap.
   A swap that did not happen moves ₹99 into this ledger, it does not refund.

   The manual adjust below is a CREDIT grant, not a payout. A reason is
   mandatory and the tap is itself written to the activity log, so every admin
   action is auditable. The real server gate is `is_staff()` in `@/server/admin`
   — this screen never decides who is an admin. */

export const Route = createFileRoute('/admin/credits')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminCredits,
})

/** Wallet `kind` is a machine enum; an admin table must never print it raw —
    the same rule the traveller-facing screens follow for statuses. */
function creditKindLabel(kind: string): 'payments.paid' | 'payments.toCredit' | 'profile.credit' {
  if (kind === 'used' || kind === 'expired') return 'profile.credit'
  if (kind === 'acceptor_credit' || kind === 'swap_to_credit') return 'payments.toCredit'
  return 'payments.paid'
}

function AdminCredits() {
  const { t, date } = useI18n()
  const { wallet } = useAppState()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const rows: AdminCreditRow[] = wallet.map((tx) => ({
    id: tx.id,
    user_last4: '••••',
    amount_paise: tx.amount_paise,
    kind: tx.kind,
    expires_at: tx.expires_at ?? '',
    created_at: tx.created_at.slice(0, 10),
  }))

  /* Design 24's four tiles, minus the one the ledger cannot answer honestly —
     "Expiring this month" needs a consumption order the ledger does not record.
     See creditSummary's note in lib/admin.ts. */
  const credit = creditSummary(wallet, Date.now())
  const tiles: Array<[string, string]> = [
    [t('admin.creditGiven'), formatRupees(credit.givenPaise)],
    [t('admin.creditUsed'), formatRupees(credit.usedPaise)],
    [t('admin.creditBalance'), formatRupees(credit.balancePaise)],
  ]

  async function adjust() {
    if (busy) return
    if (!reason.trim()) {
      setError(t('admin.adjustReasonRequired'))
      return
    }
    const rupees = Number(amount)
    if (!Number.isInteger(rupees) || rupees <= 0) {
      setError(t('admin.adjustBadAmount'))
      return
    }
    /* Every admin tap is itself audited (docs/04-D): server first, device log
       as the honest fallback. */
    setBusy(true)
    const result = await runAdminAction('adjust_credit', {
      target: 'local-device',
      reason: reason.trim(),
      amountPaise: rupees * 100,
    })
    setBusy(false)
    setError(null)
    /* "Credit added." only when the server actually added it. The device log
       records the tap but cannot move the local wallet: `credit()` in
       lib/store.ts accepts only the two fixed rule amounts
       (`CREDIT_AMOUNTS`), and an admin adjustment is by definition an
       arbitrary one. Claiming success here was the screen lying about a
       ledger sitting two cards above it. */
    setSaved(result.outcome === 'applied')
    setNotice(t(adminNoticeKey(result, 'admin.acted')))
    setAmount('')
    setReason('')
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.credits')}</h1>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <p className="text-caption text-muted">{label}</p>
            <p className="mt-1 font-head text-title font-bold text-primary">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-3 border-primary/30 bg-wash">
        <span className="flex items-center gap-2">
          <Coins aria-hidden className="size-5 text-accent" />
          <CardBody className="text-ink">{t('admin.creditNever')}</CardBody>
        </span>
      </Card>

      <Button
        className="mt-4"
        size="sm"
        onClick={() => downloadCsv('seatswap-credits.csv', creditsToCsv(rows))}
      >
        {t('admin.csv')}
      </Button>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('admin.empty')}</CardBody>
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => {
            const expired = row.expires_at !== '' && Date.parse(row.expires_at) < Date.now()
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-3"
              >
                <span className="min-w-0">
                  <b className="block truncate font-head text-body text-ink">
                    {t(creditKindLabel(row.kind))}
                  </b>
                  <small className="block text-caption text-muted">{date(row.created_at)}</small>
                </span>
                <span className="text-right">
                  <b className="block font-head text-body text-ink">
                    {formatRupees(row.amount_paise)}
                  </b>
                  <Pill tone={expired ? 'danger' : 'primary'}>
                    {expired ? t('admin.expired') : t('admin.valid')}
                  </Pill>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Card className="mt-4">
        <CardTitle>{t('admin.adjustTitle')}</CardTitle>
        <CardBody className="mt-1">{t('admin.adjustBody')}</CardBody>
        <div className="mt-3">
          <Field label={t('admin.adjustAmount')} htmlFor="admin-credit-amount" error={error}>
            <Input
              id="admin-credit-amount"
              inputMode="numeric"
              value={amount}
              placeholder="50"
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^\d]/g, ''))
                setError(null)
                setSaved(false)
              }}
            />
          </Field>
          <Field label={t('admin.adjustReason')} htmlFor="admin-credit-reason">
            <Input
              id="admin-credit-reason"
              value={reason}
              placeholder={t('admin.adjustReasonPh')}
              onChange={(event) => {
                setReason(event.target.value)
                setError(null)
                setSaved(false)
              }}
            />
          </Field>
          <Button onClick={() => void adjust()} disabled={busy}>{t('admin.adjustSave')}</Button>
          {saved ? (
            <p className="mt-2 text-caption font-semibold text-primary">{t('admin.adjustSaved')}</p>
          ) : null}
          {notice ? (
            <p className="mt-1 text-caption text-muted">{notice}</p>
          ) : null}
        </div>
      </Card>

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
