import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { adminNoticeKey, downloadCsv, runAdminAction, usersToCsv, type AdminUserRow } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { useAppState, useCreditPaise } from '@/lib/use-store'

/* Admin A3 "Users" (design 16). No full PNR, name or phone is ever rendered
   here (rule 13): the row set is limited to the masked last4 and account state.
   The real gate for any write is `is_staff()` in Postgres via `@/server/admin`. */

export const Route = createFileRoute('/admin/users')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminUsers,
})

function AdminUsers() {
  const { t, date } = useI18n()
  const { activity, settings } = useAppState()
  const creditPaise = useCreditPaise()
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function block(id: string) {
    if (busy) return
    setBusy(id)
    const result = await runAdminAction('block_user', { target: id, reason: 'admin console' })
    setBusy(null)
    if (result.outcome === 'applied') setBlocked((prev) => new Set(prev).add(id))
    setNotice(t(adminNoticeKey(result, 'admin.blocked')))
  }

  /* One row for the signed-in account, or a device-only placeholder. */
  const rows: AdminUserRow[] = [
    {
      id: settings.user_id ?? 'local-device',
      first_name: t('profile.guest'),
      last_initial: '',
      created_at: (activity[0]?.created_at ?? new Date().toISOString()).slice(0, 10),
      blocked: false,
      reported: activity.some((row) => row.action === 'report_filed'),
    },
  ]

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.users')}</h1>

      <Button
        className="mt-4"
        size="sm"
        onClick={() => downloadCsv('seatswap-users.csv', usersToCsv(rows))}
      >
        {t('admin.csv')}
      </Button>

      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const isBlocked = blocked.has(row.id)
          return (
            <li
              key={row.id}
              className="rounded-card border border-line bg-card p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <b className="block truncate font-head text-body text-ink">{row.first_name}</b>
                  <small className="block text-caption text-muted">
                    {date(row.created_at)} · {t('profile.credit')}{' '}
                    {Math.round(creditPaise / 100)}
                  </small>
                </span>
                <Pill tone={row.reported || isBlocked ? 'danger' : 'neutral'}>
                  {isBlocked ? t('admin.blocked') : row.reported ? t('admin.reports') : t('admin.valid')}
                </Pill>
              </div>
              {!isBlocked ? (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => void block(row.id)}
                  >
                    {t('admin.block')}
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {notice ? (
        <p className="mt-3 text-caption font-semibold text-primary">{notice}</p>
      ) : null}

      <Card className="mt-4">
        <CardBody>{t('admin.demoNote')}</CardBody>
      </Card>
    </div>
  )
}
