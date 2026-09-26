import { Link, createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import {
  getGroupsServerSnapshot,
  getGroupsSnapshot,
  getGroup,
  linkTrip,
  subscribeGroups,
} from '@/lib/groups'
import { listTrips } from '@/lib/store'

/* Screen 52 "Family trip" (design 19a): link PNRs, organiser pays (₹199),
   "Swapping for my parents" (docs/04 C). */

export const Route = createFileRoute('/groups/$id')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: GroupScreen,
})

function GroupScreen() {
  const { id } = Route.useParams()
  const { t, date, type, status } = useI18n()
  const toast = useToast()
  useSyncExternalStore(subscribeGroups, getGroupsSnapshot, getGroupsServerSnapshot)
  const [linkOpen, setLinkOpen] = useState(false)

  const group = getGroup(id)
  const allTrips = listTrips()
  const linked = new Set(group?.trip_ids ?? [])
  const available = allTrips.filter((trip) => !linked.has(trip.id))

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

  const groupTrips = allTrips.filter((trip) => linked.has(trip.id))

  return (
    <div>
      <h1 className="text-title text-ink">{group.name}</h1>
      <p className="mt-1 text-body text-muted">{t('groups.sub')}</p>
      <p className="mt-1 text-caption text-muted">{t('groups.linked', { n: groupTrips.length })}</p>

      <section className="mt-4 space-y-2">
        {groupTrips.map((trip) => {
          const passenger = trip.passengers[0]
          return (
            <div
              key={trip.id}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                <Users aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {trip.train_name || t('train.title', { n: trip.train_no })}
                </b>
                <small className="block text-caption text-muted">
                  {[
                    date(trip.journey_date),
                    passenger?.coach ?? '',
                    passenger ? type(passenger.berth_type) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <Pill tone={passenger?.status === 'CNF' ? 'primary' : 'neutral'}>
                {passenger ? status(passenger.status) : ''}
              </Pill>
            </div>
          )
        })}
      </section>

      <Button className="mt-4" variant="outline" onClick={() => setLinkOpen((open) => !open)}>
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