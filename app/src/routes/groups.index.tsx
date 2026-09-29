import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus, Users } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import {
  createGroup,
  getGroupsServerSnapshot,
  getGroupsSnapshot,
  groupForTrip,
  groupTogetherCount,
  subscribeGroups,
} from '@/lib/groups'
import { useTrips } from '@/lib/use-store'

/* "Family trips" — the entry into the organiser flow (docs/04 C, the reserved
   `profile.groups` / `profile.newGroup` copy). Design 19a shows one family;
   this is the list of them plus the way to make one. Nothing else in the app
   links to /groups/$id: before this screen existed the ₹199 group flow was
   unreachable — its create card (`components/new-group-card`) was rendered by
   nobody, and both its labels were translated with no route using them. */

export const Route = createFileRoute('/groups/')({
  staticData: { chrome: 'tabs', tab: 'home' } satisfies RouteChrome,
  component: GroupsListScreen,
})

function GroupsListScreen() {
  const { t, date } = useI18n()
  const navigate = useNavigate()
  useSyncExternalStore(subscribeGroups, getGroupsSnapshot, getGroupsServerSnapshot)
  const groups = getGroupsSnapshot()
  const trips = useTrips()
  /* A trip already in another family trip is not offered: it would put one
     booking in two ₹199 bundles and leave `groupForTrip()` to decide which one
     covers the swap. `createGroup` drops them too, for callers without a UI. */
  const free = trips.filter((trip) => !groupForTrip(trip.id))

  return (
    <div>
      <h1 className="text-title text-ink">{t('profile.groups')}</h1>
      <p className="mt-1 text-body text-muted">{t('groups.sub')}</p>

      {groups.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('groups.none')}</CardBody>
        </Card>
      ) : (
        <section className="mt-4 space-y-2">
          {groups.map((group) => {
            const { done, total } = groupTogetherCount(group)
            return (
              <Link
                key={group.id}
                to="/groups/$id"
                params={{ id: group.id }}
                className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                  <Users aria-hidden className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-head text-section text-ink">{group.name}</b>
                  {/* The three lines under a group name are one stack: "how many
                      trips", "how far through", "paid". The last is the money
                      one ("Group plan paid. Up to 3 swaps covered."), and
                      docs/07 §Responsive floors decision copy at 14px — so the
                      whole stack sits at `text-note` rather than the 12px step. */}
                  <small className="block text-note text-muted">
                    {t('groups.linked', { n: group.trip_ids.length })}
                  </small>
                  {total > 0 ? (
                    <small className="block text-note text-primary">
                      {t('groups.partial', { done, total })}
                    </small>
                  ) : null}
                  {group.paid ? (
                    <small className="block text-note text-muted">{t('groups.paid')}</small>
                  ) : null}
                </span>
              </Link>
            )
          })}
        </section>
      )}

      <Card className="mt-4">
        <CardTitle>{t('profile.newGroup')}</CardTitle>
        {free.length === 0 ? (
          <CardBody>{t('groups.addFirst')}</CardBody>
        ) : (
          <NewGroupForm
            trips={free.map((trip) => ({
              id: trip.id,
              label: `${trip.train_no} · ${date(trip.journey_date)}`,
            }))}
            onCreate={(name, tripIds) => {
              const group = createGroup(name, tripIds)
              navigate({ to: '/groups/$id', params: { id: group.id } })
            }}
          />
        )}
      </Card>

      <p className="mt-4 text-caption text-muted">{t('groups.organiser')}</p>

      <AppFooter />
    </div>
  )
}

/** Name + which PNRs. Create stays disabled until at least one PNR is chosen:
    an empty family trip still offers the ₹199 plan, which would charge for a
    group with nobody in it. */
function NewGroupForm({
  trips,
  onCreate,
}: {
  trips: Array<{ id: string; label: string }>
  onCreate: (name: string, tripIds: string[]) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  return (
    <div className="mt-2">
      <Field label={t('groups.title')} htmlFor="group-name">
        <Input
          id="group-name"
          value={name}
          placeholder={t('groups.title')}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <p className="mt-3 font-head text-body font-semibold text-ink">{t('home.trips')}</p>
      <div className="mt-2 flex flex-col gap-2">
        {trips.map((trip) => {
          const on = picked.includes(trip.id)
          return (
            <Button
              key={trip.id}
              variant={on ? 'primary' : 'neutral'}
              aria-pressed={on}
              onClick={() =>
                setPicked((current) =>
                  current.includes(trip.id)
                    ? current.filter((id) => id !== trip.id)
                    : [...current, trip.id],
                )
              }
            >
              {trip.label}
            </Button>
          )
        })}
      </div>

      <Button className="mt-3" disabled={picked.length === 0} onClick={() => onCreate(name, picked)}>
        <Plus aria-hidden className="size-5" />
        {t('groups.create')}
      </Button>
      <p className="mt-2 text-note text-muted">{t('groups.pay199')}</p>
    </div>
  )
}
