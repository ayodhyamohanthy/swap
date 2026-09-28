import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Info, Users } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { RESTRICTED_QUOTAS } from '@/lib/pnr'
import { markQuotaNoteSeen, removeTrip, setOpenToSwap, setReminder } from '@/lib/store'
import { useTrip } from '@/lib/use-store'

/* Screen 6 "Your berth" (design 1c), screen 7 waitlist/RAC (8c),
   screen 8 quota note (9a) and screen 50 cancelled (21a).
   Only trips that are confirmed can be swapped; a cancelled trip can just be
   removed (docs/04 A4). */

export const Route = createFileRoute('/trips/$tripId')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: TripScreen,
})

function TripScreen() {
  const { tripId } = Route.useParams()
  const { t, type, status, quota } = useI18n()
  const trip = useTrip(tripId)
  const navigate = useNavigate()
  const toast = useToast()

  if (!trip) {
    return (
      <div>
        <Card>
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" onClick={() => navigate({ to: '/' })}>
          {t('nav.home')}
        </Button>
      </div>
    )
  }

  const passenger = trip.passengers[0]
  const ticketStatus = passenger?.status ?? 'CNF'
  const restricted = passenger ? RESTRICTED_QUOTAS.includes(passenger.quota) : false
  const hasChild = trip.passengers.some((row) => row.is_child_no_berth)
  const seatWord = trip.is_chair_car
  const route = [trip.from_code, trip.to_code].filter(Boolean).join(' → ')

  return (
    <div>
      <h1 className="text-title text-ink">{trip.train_name || t('train.title', { n: trip.train_no })}</h1>
      <p className="mt-1 text-body text-muted">
        {[trip.train_no, route, t('trip.pnrEnds', { last4: trip.pnr_last4 })]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {ticketStatus === 'CNF' ? (
        <Card className="mt-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted">
            {seatWord ? t('trip.yourSeat') : t('trip.yourBerth')}
          </p>
          <p className="mt-1 font-head text-title text-ink">
            {passenger?.coach
              ? t('trip.coach', { coach: passenger.coach })
              : t('trip.noBerthYet')}
          </p>
          {passenger?.berth_no ? (
            <p className="font-head text-title text-primary">
              {seatWord
                ? t('trip.seat', { no: passenger.berth_no })
                : t('trip.berth', { no: passenger.berth_no })}
            </p>
          ) : null}
          <p className="text-body text-muted">{type(passenger?.berth_type ?? 'LB')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill tone={trip.open_to_swap ? 'primary' : 'neutral'}>
              {trip.open_to_swap ? t('home.openToSwap') : t('home.notOpen')}
            </Pill>
            <Pill>{status(ticketStatus)}</Pill>
            {passenger ? <Pill>{quota(passenger.quota)}</Pill> : null}
          </div>
        </Card>
      ) : null}

      {/* Screen 19 "Chart is out" (design 7c): the push target once the chart
          is prepared and berths are final. `chart_prepared` was on the Trip
          type with no reader anywhere in the app. */}
      {trip.chart_prepared ? (
        <Card className="mt-3 border-primary/30 bg-wash">
          <CardTitle>{t('growth.chartTitle')}</CardTitle>
          <CardBody>{t('growth.chartBody')}</CardBody>
        </Card>
      ) : null}

      {ticketStatus === 'CNF' ? (
        <Card className="mt-3 flex items-center gap-3 border-accent/40 bg-accent-soft">
          <Users aria-hidden className="size-6 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <CardTitle>{t('trip.firstTitle')}</CardTitle>
            <CardBody className="text-ink">{t('trip.firstBody')}</CardBody>
          </span>
        </Card>
      ) : null}

      {trip.is_chair_car ? (
        <p className="mt-3 rounded-card border border-line bg-card p-3 text-caption text-muted">
          {t('trip.chairCarNote')}
        </p>
      ) : null}

      {ticketStatus === 'WL' || ticketStatus === 'RAC' ? (
        <Card className="mt-4">
          <CardTitle>{ticketStatus === 'WL' ? t('trip.wlTitle') : t('trip.racTitle')}</CardTitle>
          <CardBody>{ticketStatus === 'WL' ? t('trip.wlBody') : t('trip.racBody')}</CardBody>
          <Button
            className="mt-3"
            onClick={() => {
              setReminder(trip.id, true)
              toast.show(t('trip.wlReminded'))
            }}
          >
            {t('trip.wlRemind')}
          </Button>
          <Button variant="ghost" className="mt-1" asChild>
            <Link to="/trips/add">{t('trip.wlTryAnother')}</Link>
          </Button>
        </Card>
      ) : null}

      {ticketStatus === 'CAN' ? (
        <Card className="mt-4">
          <CardTitle>{t('trip.canTitle')}</CardTitle>
          <CardBody>{t('trip.canBody')}</CardBody>
          <Button
            variant="danger"
            className="mt-3"
            onClick={() => {
              removeTrip(trip.id)
              toast.show(t('trip.removed'))
              navigate({ to: '/' })
            }}
          >
            {t('trip.remove')}
          </Button>
        </Card>
      ) : null}

      {ticketStatus === 'CNF' && passenger && restricted && !trip.quota_note_seen ? (
        <Card className="mt-3 border-accent/40 bg-accent-soft">
          <CardTitle>{t('trip.quotaTitle', { quota: quota(passenger.quota) })}</CardTitle>
          <CardBody className="text-ink">{t('trip.quotaBody')}</CardBody>
          <Button className="mt-3" onClick={() => markQuotaNoteSeen(trip.id)}>
            {t('trip.quotaOkay')}
          </Button>
        </Card>
      ) : null}

      {ticketStatus === 'CNF' ? (
        <>
          <Button className="mt-4" asChild>
            <Link to="/swaps">{t('trip.ask')}</Link>
          </Button>
          <Card className="mt-3 flex items-center gap-3">
            <span className="flex-1">
              <b className="block font-head text-body text-ink">{t('trip.open')}</b>
              <span className="block text-caption text-muted">
                {trip.open_to_swap ? t('trip.openOn') : t('trip.openOff')}
              </span>
            </span>
            <Switch
              checked={trip.open_to_swap}
              aria-label={t('trip.open')}
              onCheckedChange={(checked) => setOpenToSwap(trip.id, checked)}
            />
          </Card>
          <p className="mt-2 text-caption text-muted">{t('trip.noReward')}</p>
        </>
      ) : null}

      {trip.passengers.length > 1 || hasChild ? (
        <section className="mt-5">
          <CardTitle className="mb-2">{t('trip.passengers')}</CardTitle>
          {trip.passengers.map((row) => (
            <div
              key={row.id}
              className="mb-2 flex items-center gap-3 rounded-card border border-line bg-card p-3"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wash text-primary">
                <Users aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-head text-body text-ink">{row.label}</b>
                <small className="block text-caption text-muted">
                  {[row.coach, row.berth_no].filter(Boolean).join(' · ')}
                </small>
                <small className="block text-caption text-muted">
                  {[type(row.berth_type), status(row.status), quota(row.quota)].join(' · ')}
                </small>
              </span>
              {row.is_child_no_berth ? <Pill tone="accent">{t('add.childNoBerth')}</Pill> : null}
            </div>
          ))}
        </section>
      ) : null}

      {hasChild ? <p className="mt-2 text-caption text-muted">{t('trip.childNote')}</p> : null}

      <p className="mt-5 flex gap-2 text-caption text-muted">
        <Info aria-hidden className="size-4 shrink-0" />
        {t('trip.yourPnrNote')}
      </p>

      {ticketStatus !== 'CAN' ? (
        <Button
          variant="ghost"
          className="mt-4 justify-start text-danger"
          onClick={() => {
            removeTrip(trip.id)
            toast.show(t('trip.removed'))
            navigate({ to: '/' })
          }}
        >
          {t('trip.remove')}
        </Button>
      ) : null}

      <AppFooter />
    </div>
  )
}
