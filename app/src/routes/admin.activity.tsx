import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Circle,
  CreditCard,
  FileText,
  LogIn,
  Send,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_TRAIN_FIELD,
  activityActions,
  activityCategory,
  activityDetailsExcept,
  activityLabelKey,
  activityToCsv,
  activityTrain,
  downloadCsv,
  filterActivity,
  uncategorisedActions,
  type ActivityCategory,
} from '@/lib/admin'
import { localeFor, useI18n, type LangCode, type MessageKey } from '@/lib/i18n'
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

/**
 * Design 15's Action column carries an icon per row, and it is the screen's
 * biggest scanning win: an operator finds the payment among forty rows by
 * shape, before reading a word.
 *
 * Keyed by CATEGORY, not by action. There are ~50 actions and eight
 * categories, so an action map would need a new entry (and a new colour
 * decision) every time a lane logs something new, and the day someone forgets
 * is the day a row renders no icon. Category is already the exhaustive,
 * guarded mapping — `tests/admin.test.ts` fails if a logged action lands in
 * `other` — and `Record<ActivityCategory, …>` makes a missing entry a
 * TYPE error rather than a blank cell.
 */
const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = {
  trips: FileText,
  requests: Send,
  payments: CreditCard,
  swaps: ArrowLeftRight,
  reports: AlertTriangle,
  signins: LogIn,
  account: Settings,
  other: Circle,
}

/** Semantic tokens only (AGENTS.md conventions): no raw hex in a component.
    Only the two rows an operator must not miss get a colour — money and a
    report — because eight colours is a legend, not a signal. */
const CATEGORY_TONE: Record<ActivityCategory, string> = {
  trips: 'text-muted',
  requests: 'text-primary',
  payments: 'text-accent',
  swaps: 'text-primary',
  reports: 'text-danger',
  signins: 'text-muted',
  account: 'text-muted',
  other: 'text-muted',
}

/** The row's action, as an icon + its label. Shared by the table and the
    narrow list so the two cannot drift. */
function ActionCell({ action, label }: { action: string; label: string }) {
  const category = activityCategory(action)
  const Icon = CATEGORY_ICON[category]
  return (
    <span className="flex items-center gap-2">
      {/* Decorative: the label beside it already says what happened, so a
          screen reader should not hear the category twice. */}
      <Icon aria-hidden className={`size-4 shrink-0 ${CATEGORY_TONE[category]}`} />
      <span className="truncate font-head text-body text-ink" title={action}>
        {label}
      </span>
    </span>
  )
}

/** Held back from Details because the Train column renders it (by key, not by
    string surgery — see `activityDetailsExcept`). */
const TRAIN_ONLY = [ACTIVITY_TRAIN_FIELD] as const

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 text-caption font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>
}

/**
 * Design 15's Time column is a clock, not a date: an operator reading an audit
 * trail is placing events within the last hour. The date stays as the cell's
 * tooltip (and on its own line in the narrow layout) so a row from yesterday
 * can never be misread as one from this morning.
 *
 * Hour and minute only, through the active locale, so a Hindi console reads
 * Devanagari digits like the rest of the app. Falls back to the raw ISO clock
 * rather than throwing if a runtime has no data for the locale.
 */
export function activityClock(iso: string, lang: LangCode): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(at)
  } catch {
    return iso.slice(11, 16)
  }
}

function AdminActivity() {
  const { t, date, lang } = useI18n()
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
        <>
          {/* Design 15 is a ~1080px console and its log is a real table: Time /
              Action / Train / Details, scanned top-to-bottom by column. Below
              `lg` that does not fit — `AppShell` clamps every screen to
              `.app-column` (34rem) — so the same rows render as cards there.
              One `rows` array, two layouts; no second filter, no second sort.

              The design's fifth column, User, is deliberately absent: every row
              is written with one opaque `actor_id` and a hardcoded `'user'`
              role (`lib/store.ts`), so the column would repeat one string down
              the page. Names arrive with peer rows, not with markup. */}
          <div className="mt-4 hidden overflow-x-auto rounded-card border border-line bg-card lg:block">
            <table className="w-full border-collapse text-body">
              <caption className="sr-only">{t('admin.log')}</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>{t('admin.colWhen')}</Th>
                  <Th>{t('admin.colAction')}</Th>
                  <Th>{t('admin.colTrain')}</Th>
                  <Th>{t('admin.colDetails')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0 align-top">
                    <Td className="whitespace-nowrap text-muted">
                      <time dateTime={row.created_at} title={date(row.created_at.slice(0, 10))}>
                        {activityClock(row.created_at, lang)}
                      </time>
                    </Td>
                    <Td>
                      <ActionCell action={row.action} label={t(activityLabelKey(row.action))} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink">{activityTrain(row) ?? '—'}</Td>
                    <Td className="text-muted">{activityDetailsExcept(row, TRAIN_ONLY)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-4 space-y-2 lg:hidden">
            {rows.map((row) => {
              const train = activityTrain(row)
              const detail = activityDetailsExcept(row, TRAIN_ONLY)
              return (
                <li key={row.id} className="rounded-card border border-line bg-card p-3">
                  <ActionCell action={row.action} label={t(activityLabelKey(row.action))} />
                  {/* Train keeps its own line here too, so the narrow layout
                      reads the same fields in the same order as the table. */}
                  {train ? (
                    <small className="mt-0.5 block truncate text-caption text-ink">
                      {t('admin.colTrain')} {train}
                    </small>
                  ) : null}
                  {detail ? (
                    <small className="mt-0.5 block truncate text-caption text-muted" title={detail}>
                      {detail}
                    </small>
                  ) : null}
                  <small className="block text-caption text-muted">
                    <time dateTime={row.created_at}>
                      {date(row.created_at.slice(0, 10))} · {activityClock(row.created_at, lang)}
                    </time>{' '}
                    · {row.actor_role}
                  </small>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
