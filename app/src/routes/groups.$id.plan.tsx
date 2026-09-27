import { Link, createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
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
  groupTogetherCount,
  subscribeGroups,
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
  /* Bundle consumption at a glance (docs/01): filled dots = covered swaps
     used. Wordless on purpose — no new copy needed in any language. */
  const used = group.paid ? Math.min(groupLockedCount(group.id), GROUP_MAX_SWAPS) : 0

  return (
    <div>
      <h1 className="text-title text-ink">{t('groups.planTitle')}</h1>
      <p className="mt-1 text-body text-muted">{t('groups.planBody')}</p>

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