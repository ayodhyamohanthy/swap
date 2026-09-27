import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { activityActions, activityToCsv, downloadCsv, filterActivity } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { useAppState } from '@/lib/use-store'

/* Admin A2 "Activity log" (design 15). Every state change in the app writes a
   row here, so this is the audit trail. Search never matches a full PNR: only
   the masked last4 and train numbers are present in the data. */

export const Route = createFileRoute('/admin/activity')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminActivity,
})

function AdminActivity() {
  const { t, date } = useI18n()
  const { activity } = useAppState()
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<string | null>(null)

  const actions = activityActions(activity)
  const rows = filterActivity(activity, { action, query })

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.log')}</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => downloadCsv('seatswap-activity.csv', activityToCsv(rows))}
        >
          {t('admin.csv')}
        </Button>
      </div>

      <Field label={t('admin.searchPh')} htmlFor="admin-activity-search" className="mt-4">
        <Input
          id="admin-activity-search"
          value={query}
          placeholder={t('admin.searchPh')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      <div className="mt-2">
        <label htmlFor="admin-action" className="mb-1.5 block text-caption font-semibold uppercase tracking-wide text-muted">
          {t('admin.colAction')}
        </label>
        <select
          id="admin-action"
          className="w-full min-h-12 rounded-xl border border-line bg-card px-3.5 text-body text-ink"
          value={action ?? ''}
          onChange={(event) => setAction(event.target.value || null)}
        >
          <option value="">{t('admin.filterAll')}</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
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
                <b className="block truncate font-head text-body text-ink">{row.action}</b>
                <small className="block text-caption text-muted">
                  {date(row.created_at.slice(0, 10))} · {row.actor_role}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
