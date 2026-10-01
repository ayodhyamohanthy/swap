import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  CircleHelp,
  Flag,
  LogIn,
  ReceiptIndianRupee,
  Send,
  Settings,
  Ticket,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_TONE_CLASS,
  activityActions,
  activityCategory,
  activityDetails,
  activityLabelKey,
  activityTime,
  activityToCsv,
  activityTone,
  activityTrain,
  downloadCsv,
  filterActivity,
  uncategorisedActions,
  userTimelines,
  type ActivityCategory,
} from '@/lib/admin'
import { actorRoleLabel, useI18n, type MessageKey } from '@/lib/i18n'
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
 * The glyph per category — design 15 draws one, and it is what makes a long
 * log scannable.
 *
 * Keyed by **category**, not by action, and that is the design decision worth
 * stating: 49 hand-picked glyphs would be 49 arbitrary calls nobody can verify,
 * whereas these eight come straight from `ACTIVITY_CATEGORIES` — so the icon a
 * row shows is the same taxonomy as the chip that filters it, and an operator
 * can read the filter off the icon. The design's own per-action icons (a
 * paper-plane for "Sent request", a check for "Accepted") are two glyphs for
 * one category, which is the distinction the *tone* now carries instead.
 *
 * The map is total over `ActivityCategory` — `other` included — so an action
 * that lands in `other` is still drawn and still obvious.
 */
const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = {
  trips: Ticket,
  requests: Send,
  payments: ReceiptIndianRupee,
  swaps: ArrowLeftRight,
  reports: Flag,
  signins: LogIn,
  account: Settings,
  other: CircleHelp,
}

/**
 * Design 15's five columns are Time / User / Action / Train / Details, and
   **four of the five are drawn** — this comment used to say two, which was
   already wrong when the User timeline panel shipped, and said nothing about
   Train at all. Train IS its own column (`admin.colTrain`), drawn in `f65f8aa`;
   the note that follows the table — "Details stays in the Action cell rather
   than becoming a fifth column" — was written before that and still read as a
   claim that no train column existed. A stale comment directly above a working
   feature is the same failure this board has already paid for twice (design 17's
   panel, and backlog 3 here), so it is corrected rather than left to mislead the
   next reader.

   What the five columns actually became:

     - **Time** — its own track at `lg`, folded into the card caption below it.
     - **Action** — the icon track plus the label, with Details as its caption.
     - **Train** — its own track, and `activityDetails(row, { omit: ['train_no'] })`
       keeps the number out of Details so one fact is not printed twice per row.
     - **Details** — deliberately *not* a fifth column. The design's own rows show
       short values ("UPI", "A2", "Wants Lower") because they are hand-written; a
       real row is a `·`-separated list up to 60 chars, and a fifth column on a
       1080px console would truncate exactly the field an operator came for.
     - **User** ("Riya P") — the one column that cannot be built. `ActivityRow` has
       no name field, the same missing-peer-row blocker as `admin.users.tsx` and
       `get_matches()`. The design's name is a mock, and
       `tests/qa-placeholders.test.ts` bans inventing one.

   The User **timeline panel** beside the table in the design is built and ships
   below it: it groups by `actor_id`, which every row carries, so the panel
   exists without a name. It cannot print one either — there is none to print. */

function AdminActivity() {
  const { t, date, lang } = useI18n()
  const { activity } = useAppState()
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<string | null>(null)
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all')

  const actions = activityActions(activity)
  const uncategorised = uncategorisedActions(activity)
  const rows = filterActivity(activity, { action, category, query })
  /* The panel reads the WHOLE log, not the filtered rows: it is a per-actor
     summary beside a filtered table, so narrowing the table to "Payments"
     should not silently re-label who has history. A panel that tracked the
     filter would also be useless for its actual job — answering "what else did
     this person do", which is the question a timeline is opened for. */
  const timelines = userTimelines(activity, { limitPerUser: 6 })

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
        /* One DOM, two layouts. Below `lg` this is the phone card list it has
           always been; at `lg` the same elements are placed into design 15's
           columns with `grid-cols` + explicit `col-start`. Rendering the table
           and the list as two separate markups would be the usual way and would
           also be two places for the values to drift apart — this way the phone
           view and the desktop view cannot disagree, because there is only one
           of each value. */
        <div className="mt-4 lg:overflow-hidden lg:rounded-card lg:border lg:border-line lg:bg-card">
          {/* A visual ruler for the desktop grid, and the only place the column
              names appear. `hidden` keeps it out of the phone layout, where each
              card already labels itself. Four tracks, not three: the icon is its
              own track so the Action heading can span the icon and its label. */}
          <div className="hidden lg:grid lg:grid-cols-[8.5rem_auto_minmax(0,1fr)_5.5rem] lg:gap-4 lg:border-b lg:border-line lg:px-4 lg:py-2 lg:text-caption lg:font-semibold lg:uppercase lg:tracking-wide lg:text-muted">
            <span className="lg:col-start-1">{t('admin.colWhen')}</span>
            <span className="lg:col-span-2 lg:col-start-2">{t('admin.colAction')}</span>
            <span className="lg:col-start-4">{t('admin.colTrain')}</span>
          </div>

          <ul className="space-y-2 lg:space-y-0">
            {rows.map((row) => {
              /* The train has its own column now, so it is left out of the
                 Details list — the same number twice in one row reads as two
                 facts. */
              const detail = activityDetails(row, { omit: ['train_no'] })
              const train = activityTrain(row)
              const tone = activityTone(row.action)
              const Icon = CATEGORY_ICON[activityCategory(row.action)]
              /* Every row in the local stub is the passenger's own, so the
                 common case says nothing. The role is shown only when it is
                 NOT `user`, which is the case worth flagging: `jobs.ts` writes
                 `support` with `actor_id: 'system'` and `server/admin.ts` writes
                 `admin`, so this is what marks a row as automation or an
                 operator rather than a passenger. It joins the Details tokens
                 rather than the When column: it is who acted, not when, and the
                 When track is too narrow to hold a third value without running
                 into the icon. */
              const staffRole = row.actor_role === 'user' ? null : actorRoleLabel(lang, row.actor_role)
              const tokens = [detail, staffRole].filter(Boolean).join(' · ')

              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-card border border-line bg-card p-3 lg:grid-cols-[8.5rem_auto_minmax(0,1fr)_5.5rem] lg:items-baseline lg:gap-x-4 lg:gap-y-0 lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:px-4 lg:py-3 lg:last:border-b-0"
                >
                  {/* Every child is placed explicitly at both widths. Leaving any
                      of them to auto-placement made the Action cell jump columns
                      whenever a row had no train number — the count of grid items
                      changes, so the fill order changes with it. */}
                  <span
                    aria-hidden
                    className={`col-start-1 row-span-2 row-start-1 flex size-8 shrink-0 items-center justify-center rounded-lg lg:col-start-2 lg:row-span-1 ${ACTIVITY_TONE_CLASS[tone]}`}
                  >
                    <Icon className="size-4" />
                  </span>

                  <span className="col-start-2 row-start-1 min-w-0 lg:col-start-3">
                    {/* The label is what an admin reads; the raw action stays as
                        a tooltip so the row is still greppable against the
                        code. */}
                    <b className="block truncate font-head text-body text-ink" title={row.action}>
                      {t(activityLabelKey(row.action))}
                    </b>
                    {tokens ? (
                      <small className="mt-0.5 block truncate text-caption text-muted" title={tokens}>
                        {tokens}
                      </small>
                    ) : null}
                  </span>

                  {/* `lg:block` dissolves this wrapper at desktop width, so
                      the date and the train become grid items in their own
                      columns; below `lg` it is one wrapped caption line under
                      the card. That is why it has to stay a direct child of the
                      row — nesting it inside the Action cell would make its
                      children flex items instead of grid items. */}
                  <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-1.5 text-caption text-muted lg:contents">
                    <span className="lg:col-start-1 lg:row-start-1 lg:whitespace-nowrap">
                      {date(row.created_at.slice(0, 10))} · {activityTime(row.created_at, lang)}
                    </span>
                    {train ? (
                      <>
                        <span aria-hidden className="lg:hidden">
                          ·
                        </span>
                        <span className="lg:col-start-4 lg:row-start-1">{train}</span>
                      </>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Design 15's right-hand **User timeline**, below the table rather than
          beside it. The design draws it in a right column at ~1600px, but the
          console's own measure stops at 1440 (AGENTS.md rule 12a) and a
          two-column split at 1180px would squeeze the table's own columns —
          which are already the tight part. So the panel is a full-width section
          after the table at every width, and the design's shape (a title, one
          group per actor, newest first, time on the left) is what is preserved.

          It renders nothing at all when there is no log, rather than an empty
          panel titled "User timeline" — a heading over nothing is worse than
          no heading. */}
      {timelines.length > 0 ? (
        <section aria-labelledby="admin-timeline-heading" className="mt-6">
          <h2 id="admin-timeline-heading" className="text-head text-ink">
            {t('admin.userTimeline')}
          </h2>
          {/* One column of groups at `sm`, two from `lg`. The groups are
              independent, so a grid (not a flex row) is what makes the second
              column line up without a hardcoded height. */}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {timelines.map((group) => {
              /* No name exists, so the heading says what the id IS rather than
                 pretending to know who it is. The raw id is kept visible and
                 selectable: an operator reading an audit log needs the id they
                 can paste into a search, and a design's "Riya P" is a mock. */
              const isAutomation = group.actorId === null
              return (
                <li key={group.actorId ?? '\0automation'}>
                  <Card>
                    <CardBody>
                      <div className="flex items-baseline justify-between gap-2">
                        <b className="truncate font-head text-body text-ink">
                          {isAutomation
                            ? t('admin.timelineAutomation')
                            : group.actorId}
                        </b>
                        {!isAutomation && group.role !== 'user' ? (
                          <span className="shrink-0 text-caption text-muted">
                            {group.role}
                          </span>
                        ) : null}
                      </div>

                      <ol className="mt-2 space-y-2">
                        {group.entries.map((entry) => {
                          const Icon = CATEGORY_ICON[activityCategory(entry.action)]
                          const tone = activityTone(entry.action)
                          return (
                            <li key={entry.id} className="flex items-start gap-2.5">
                              <span
                                aria-hidden
                                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${ACTIVITY_TONE_CLASS[tone]}`}
                              >
                                <Icon className="size-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                {/* The label, with the time beside it. The raw
                                    action stays a tooltip so the line is still
                                    greppable against the code — the same
                                    contract the table row uses. */}
                                <span className="flex flex-wrap items-baseline gap-x-2">
                                  <b
                                    className="truncate font-head text-body text-ink"
                                    title={entry.action}
                                  >
                                    {t(activityLabelKey(entry.action))}
                                  </b>
                                  <small className="text-caption text-muted">
                                    {activityTime(entry.at, lang)}
                                  </small>
                                </span>
                                {/* Train and details, joined the way the table
                                    joins them. Either may be absent, and an
                                    empty line is not rendered at all. */}
                                {entry.train || entry.detail ? (
                                  <small className="mt-0.5 block truncate text-caption text-muted">
                                    {[entry.train, entry.detail].filter(Boolean).join(' · ')}
                                  </small>
                                ) : null}
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    </CardBody>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
