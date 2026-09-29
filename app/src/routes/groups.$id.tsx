import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { Baby, ChevronRight, Plus, TrainFront, User, Users } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import {
  getGroupsServerSnapshot,
  getGroupsSnapshot,
  getGroup,
  groupForTrip,
  groupJourney,
  linkTrip,
  subscribeGroups,
} from '@/lib/groups'
import { listTrips } from '@/lib/store'

/* Screen 52 "Family trip" (design 19a): link PNRs, organiser pays (₹199),
   "Swapping for my parents" (docs/04 C).

   One row per linked ticket, labelled with the masked PNR ("PNR ends 4821", the
   only form of a PNR this app prints — the store keeps no full PNR at all) and
   then one `coach · berth` chip per person, because a ticket is not a seat:
   design 19a lists a ticket holding 2 people and design 5a prints "A2 · 12" per
   member. Rule 13 is not in tension with any of this — these are the organiser's
   own linked PNRs on their own device, never another user's. */

export const Route = createFileRoute('/groups/$id')({
  component: GroupLayout,
})

/** Layout: the family screen renders at the index route; /plan renders here. */
function GroupLayout() {
  return <Outlet />
}

export function GroupScreen() {
  const { id } = Route.useParams()
  const { t, date, status } = useI18n()
  const toast = useToast()
  useSyncExternalStore(subscribeGroups, getGroupsSnapshot, getGroupsServerSnapshot)
  const [linkOpen, setLinkOpen] = useState(false)

  const group = getGroup(id)
  const allTrips = listTrips()
  const linked = new Set(group?.trip_ids ?? [])
  /* A trip already in another family trip cannot be linked here too — one
     booking in two ₹199 bundles leaves `groupForTrip()` guessing which covers
     the swap (see `freeTripIds` in lib/groups). */
  const available = allTrips.filter((trip) => !linked.has(trip.id) && !groupForTrip(trip.id))

  if (!group) {
    return (
      <div>
        <Card>
          <CardTitle>{t('groups.none')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/groups">{t('profile.groups')}</Link>
        </Button>
      </div>
    )
  }

  const groupTrips = allTrips.filter((trip) => linked.has(trip.id))
  const journey = groupJourney(group)

  return (
    <div>
      <h1 className="text-title text-ink">{group.name}</h1>
      <p className="mt-1 text-body text-muted">{t('groups.sub')}</p>

      {journey ? (
        <Card className="mt-4 flex items-center gap-3">
          <TrainFront aria-hidden className="size-6 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 font-head text-body text-ink">
            {`${journey.train_no} ${journey.train_name}`.trim()} · {date(journey.journey_date)}
          </span>
        </Card>
      ) : null}

      <p className="mt-3 text-caption text-muted">{t('groups.linked', { n: groupTrips.length })}</p>

      <section className="mt-2 space-y-2">
        {groupTrips.map((trip) => {
          const seats = trip.passengers
            .filter((passenger) => !passenger.is_child_no_berth)
            .map((passenger) =>
              [passenger.coach ?? '', passenger.berth_no ?? ''].filter(Boolean).join(' · '),
            )
            .filter(Boolean)
          const children = trip.passengers.filter((row) => row.is_child_no_berth).length
          const passenger = trip.passengers[0]
          const Icon =
            children > 0 && seats.length === 0
              ? Baby
              : trip.passengers.length > 1
                ? Users
                : User
          return (
            /* Design 19a draws every linked ticket as a row with a chevron, and
               the chevron means somewhere to go: the organiser wants to look at
               the berth behind "PNR ••• 4821 · 2 people · A2". A plain <div>
               makes the affordance a lie — it looks tappable and is not. */
            <Link
              key={trip.id}
              to="/trips/$tripId"
              params={{ tripId: trip.id }}
              className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {t('trip.pnrEnds', { last4: trip.pnr_last4 })}
                </b>
                <small className="block truncate text-caption text-muted">
                  {seats.length > 0 ? seats.join(' · ') : '—'}
                  {children > 0 ? ` · ${t('add.childNoBerth')}` : ''}
                </small>
              </span>
              {passenger && passenger.status !== 'CNF' ? (
                <Pill tone={passenger.status === 'CAN' ? 'danger' : 'accent'}>
                  {status(passenger.status)}
                </Pill>
              ) : null}
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
            </Link>
          )
        })}
      </section>

      <Button className="mt-4" variant="outline" onClick={() => setLinkOpen((open) => !open)}>
        <Plus aria-hidden className="size-5" />
        {t('groups.link')}
      </Button>

      {linkOpen ? (
        <Card className="mt-3">
          <CardTitle>{t('groups.link')}</CardTitle>
          {available.length === 0 ? (
            <CardBody>{t('home.empty')}</CardBody>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {available.map((trip) => (
                <Button
                  key={trip.id}
                  variant="neutral"
                  onClick={() => {
                    linkTrip(group.id, trip.id)
                    toast.show(t('groups.linked', { n: group.trip_ids.length + 1 }))
                  }}
                >
                  {trip.train_no} · {date(trip.journey_date)}
                </Button>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <Card className="mt-4 border-accent/40 bg-accent-soft">
        <CardTitle>{t('groups.parents')}</CardTitle>
        <CardBody className="text-ink">{t('groups.parentsBody')}</CardBody>
        <p className="mt-1 text-caption text-muted">{t('groups.organiser')}</p>
      </Card>

      <Button className="mt-4" asChild>
        <Link to="/groups/$id/plan" params={{ id: group.id }}>
          {t('groups.planTitle')}
        </Link>
      </Button>
    </div>
  )
}
