import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import {
  ACTIVITY_CATEGORIES,
  activityActions,
  activityLabelKey,
  activityToCsv,
  downloadCsv,
  filterActivity,
  uncategorisedActions,
  type ActivityCategory,
} from '@/lib/admin'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { useAppState } from '@/lib/use-store'

/* Admin A2 "Activity log" (design 15). Every state change in the app writes a
   row here, so this is the audit trail. Search never matches a full PNR: only
   the masked last4 and train numbers are present in the data. */

export const Route = createFileRoute('/admin/activity')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminActivity,
})

/**
 * Chip label per category. Payments/Swaps/Reports reuse the sidebar's own
 * labels — same word, same meaning — so the two cannot drift apart in
 * translation. The rest are their own keys.
 *
 * Chips are `Button size="sm"`, so they are 48px tall: taller than design 15's
 * compact chips, because this repo's touch-target floor is not negotiable
 * (components/ui/button.tsx).
 */
const CATEGORY_LABEL: Record<ActivityCategory | 'all', MessageKey> = {
  all: 'admin.catAll',
  trips: 'admin.catTrips',
  requests: 'admin.catRequests',
  payments: 'admin.payments',
  swaps: 'admin.swaps',
  reports: 'admin.reports',
  signins: 'admin.catSignins',
  account: 'admin.catAccount',
  other: 'admin.catOther',
}

function AdminActivity() {
  const { t, date } = useI18n()
  const { activity } = useAppState()
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<string | null>(null)
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all')

  const actions = activityActions(activity)
  const uncategorised = uncategorisedActions(activity)
  const rows = filterActivity(activity, { action, category, query })

  /* `other` is offered only when something actually landed in it, so an action
     added without updating the category map shows up loudly instead of being
     silently absent from every chip. */
  const chips: Array<ActivityCategory | 'all'> = [
    'all',
    ...ACTIVITY_CATEGORIES,
    ...(uncategorised.length > 0 ? (['other'] as const) : []),
  ]

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

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('admin.catLabel')}>
        {chips.map((chip) => (
          <Button
            key={chip}
            size="sm"
            variant={chip === category ? 'primary' : 'neutral'}
            aria-pressed={chip === category}
            /* Clearing the action avoids a contradictory pair (say Payments +
               `pnr_added`) that can only ever render the empty state. */
            onClick={() => {
              setCategory(chip)
              setAction(null)
            }}
          >
            {t(CATEGORY_LABEL[chip])}
          </Button>
        ))}
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
              {t(activityLabelKey(name))}
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
                {/* The label is what an admin reads; the raw action stays as a
                    tooltip so the row is still greppable against the code. */}
                <b className="block truncate font-head text-body text-ink" title={row.action}>
                  {t(activityLabelKey(row.action))}
                </b>
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
