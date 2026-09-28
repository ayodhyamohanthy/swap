import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { GROUP_MAX_SWAPS, GROUP_PRICE_PAISE, formatRupees } from '@/lib/money'
import { groupLockedCount } from '@/lib/requests'
import {
  getGroupsServerSnapshot,
  getGroupsSnapshot,
  getGroup,
  groupBayRows,
  groupCoachMap,
  groupJourney,
  groupTogetherCount,
  groupUnplacedBerths,
  subscribeGroups,
  type GroupCoach,
} from '@/lib/groups'
import { listTrips } from '@/lib/store'

/* Screen 53 "Seat everyone together" (design 19b): one plan, partial results
   ("3 of 4 together"), ₹199 once for up to 3 swaps (docs/01, docs/04 C). */

export const Route = createFileRoute('/groups/$id/plan')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: GroupPlanScreen,
})

function GroupPlanScreen() {
  const { id } = Route.useParams()
  const { t, date, type } = useI18n()
  /* Which coach the map strip is showing. Declared before the empty-state
     return below: hook order must never depend on which branch was taken. */
  const [coachIndex, setCoachIndex] = useState(0)
  useSyncExternalStore(subscribeGroups, getGroupsSnapshot, getGroupsServerSnapshot)
  const group = getGroup(id)

  if (!group) {
    return (
      <div>
        <Card>
          <CardTitle>{t('groups.none')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/">{t('nav.home')}</Link>
        </Button>
      </div>
    )
  }

  const { done, total } = groupTogetherCount(group)
  const trips = listTrips().filter((trip) => group.trip_ids.includes(trip.id))
  /* Two different counts on one screen, on purpose — do not merge them.
     `done/total` above is how many of the family are seated together now
     (train + date + coach). `used` below is bundle consumption against
     GROUP_MAX_SWAPS (locked + confirmed member swaps). A swap can be paid for
     and still not seat anyone together, and vice versa.
     Bundle consumption at a glance (docs/01): filled dots = covered swaps
     used. Wordless on purpose — no new copy needed in any language. */
  const used = group.paid ? Math.min(groupLockedCount(group.id), GROUP_MAX_SWAPS) : 0

  /* Design 19b subtitles the plan with the journey ("12752 Rajdhani ·
     Fri 12 Jun"). `groupJourney` returns null when the linked tickets do not
     share one train and date — then there is nothing honest to headline. */
  const journey = groupJourney(group)

  /* Design 19b's coach map (docs/04 C: "see everyone on one coach map"). It
     holds the family's own berths and nothing else — see `groupCoachMap` for
     why the rest of the coach is not drawn. */
  const { coaches, unseated } = groupCoachMap(group)
  const count = coaches.length
  /* Clamped, not trusted: unlinking a PNR while this screen is open can shrink
     the list from under the index. `at` is the single index that every arrow
     both reads and writes, so a label can never name a different coach from
     the one the tap goes to. */
  const at = count > 0 ? Math.min(coachIndex, count - 1) : -1
  const current = at >= 0 ? coaches[at] : undefined
  const prev = count > 1 ? coaches[(at - 1 + count) % count] : undefined
  const next = count > 1 ? coaches[(at + 1) % count] : undefined
  const step = (delta: number) =>
    setCoachIndex((index) => {
      const from = Math.min(index, count - 1)
      return (from + delta + count) % count
    })
  /* The arrows say where they go rather than "previous"/"next", because the
     only word for a coach this app has is the coach itself — no new copy in
     any of the 22 catalogues for a chevron. The train number is prefixed only
     when the family is not all on one journey, which is exactly the case where
     two coaches can share a code; and then it has to be the *target* coach's
     own train, or the label names a place the tap does not go. */
  const coachName = (coach: GroupCoach) =>
    journey
      ? t('trip.coach', { coach: coach.coach })
      : `${coach.train_no} · ${t('trip.coach', { coach: coach.coach })}`
  const bayRows = current ? groupBayRows(current) : []
  const unplaced = current ? groupUnplacedBerths(current) : []
  const berthNumbers = current ? current.berths.map((berth) => berth.berth_no).filter(Boolean) : []

  return (
    <div>
      <h1 className="text-title text-ink">{t('groups.planTitle')}</h1>
      {journey ? (
        <p className="mt-1 text-body text-ink">
          {`${journey.train_no} ${journey.train_name}`.trim()} · {date(journey.journey_date)}
        </p>
      ) : null}
      <p className="mt-1 text-body text-muted">{t('groups.planBody')}</p>

      {current || unseated > 0 ? (
        <Card className="mt-4">
          {current ? (
            <>
              {/* Design 19b draws the stepper *inside* the frame, one arrow
                  either side of the coach name. */}
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={prev ? coachName(prev) : undefined}
                  disabled={count < 2}
                  onClick={() => step(-1)}
                >
                  <ChevronLeft aria-hidden className="size-5" />
                </Button>
                <span className="flex-1 text-center font-head text-body font-semibold text-ink">
                  {coachName(current)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={next ? coachName(next) : undefined}
                  disabled={count < 2}
                  onClick={() => step(1)}
                >
                  <ChevronRight aria-hidden className="size-5" />
                </Button>
              </div>

              {/* One row per bay the family is in, so "together" is legible as
                  a shape and not just a count: two berths in one row are in one
                  bay, two rows are not. The empty slots are positions the
                  coach's numbering put there — they carry no number and no
                  name, because this app has never seen who holds them and rule
                  13 forbids printing it. Keep them blank. */}
              <div
                className="mt-3 space-y-2"
                role="img"
                aria-label={`${coachName(current)}${berthNumbers.length ? ` · ${berthNumbers.join(' ')}` : ''}`}
              >
                {bayRows.map((row) => (
                  /* A grid, not a flex-wrap. A bay is eight slots in ONE row,
                     and the row is the entire message — two berths on one line
                     are in one bay, two lines are not. Wrapped, a bay's eighth
                     slot drops to a second line and reads as a different bay,
                     which silently destroys the only thing the map says.
                     `grid-cols-8` cannot wrap; the cells shrink instead. */
                  <div key={row.bay} className="grid grid-cols-8 gap-1.5">
                    {row.slots.map((berth, i) =>
                      berth ? (
                        <span
                          key={`berth-${berth.berth_no}-${i}`}
                          className="flex aspect-square items-center justify-center rounded-lg bg-primary font-head text-caption font-bold text-primary-ink"
                        >
                          {berth.berth_no || '·'}
                        </span>
                      ) : (
                        <span
                          key={`slot-${i}`}
                          aria-hidden
                          className="aspect-square rounded-lg border border-line bg-wash"
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>

              {unplaced.length > 0 ? (
                /* Seated, but the numbering cannot place them — a chair-car
                   seat, or a confirmed seat with no number. Deliberately NOT
                   the seatless row below: that row means "no seat yet", and
                   these people have one. Wordless, like the cover dots. */
                <div className="mt-3 flex flex-wrap justify-center gap-2 border-t border-line pt-3">
                  {unplaced.map((berth, i) => (
                    <span
                      key={`seat-${i}`}
                      className="flex size-11 items-center justify-center rounded-lg bg-primary font-head text-caption font-bold text-primary-ink"
                    >
                      {berth.berth_no || '·'}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {unseated > 0 ? (
            /* Outside the coach strip on purpose: these family members have no
               coach at all — waitlisted, RAC, or a child travelling without a
               berth (docs/04 C). Drawing them inside a coach would place them
               somewhere they are not. Wordless, like the cover dots below. */
            <div className="mt-3 flex flex-wrap justify-center gap-2 border-t border-line pt-3">
              {Array.from({ length: unseated }, (_, i) => (
                <span
                  key={`out-${i}`}
                  className="flex size-11 items-center justify-center rounded-lg border border-dashed border-line text-muted"
                >
                  ·
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="mt-4 border-primary/30 bg-wash">
        <p className="font-head text-title text-primary">
          {t('groups.partial', { done, total })}
        </p>
        <CardBody className="text-ink">{t('groups.pay199')}</CardBody>
        <p className="mt-1 font-head text-section font-bold text-ink">
          {formatRupees(GROUP_PRICE_PAISE)}
        </p>
        {group.paid ? (
          <>
            <p className="mt-2 text-body font-semibold text-primary">{t('groups.paid')}</p>
            <div className="mt-2 flex gap-2" role="img" aria-label={`${used}/${GROUP_MAX_SWAPS}`}>
              {Array.from({ length: GROUP_MAX_SWAPS }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={`size-3 rounded-full ${i < used ? 'bg-primary' : 'bg-line'}`}
                />
              ))}
            </div>
          </>
        ) : (
          <Button className="mt-3" asChild>
            <Link to="/pay/$requestId" params={{ requestId: group.id }}>
              {t('pay.pay199')}
            </Link>
          </Button>
        )}
      </Card>

      <section className="mt-4 space-y-2">
        {trips.map((trip) => {
          const passenger = trip.passengers[0]
          return (
            <div
              key={trip.id}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3"
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {trip.train_name || t('train.title', { n: trip.train_no })}
                </b>
                <small className="block text-caption text-muted">
                  {[date(trip.journey_date), passenger?.coach ?? ''].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="text-caption text-muted">
                {passenger ? type(passenger.berth_type) : ''}
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}