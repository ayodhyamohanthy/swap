import { Link, createFileRoute } from '@tanstack/react-router'
import { Link2 } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { createInvite, inviteLink } from '@/lib/invites'
import { getTrip, listTrips } from '@/lib/store'

/* Screen 34 "On the train now board" (design 7a): live coach board until the
   user's stop; only travellers marked open to swap appear, and only with
   coach + berth type — never a name, PNR or berth number (rule 13).

   docs/05 gives it the Home tab and design 7a draws the tab bar, so it is a
   normal tab screen even though the usual way in is a coach link (33). */

export const Route = createFileRoute('/onboard/$tripId')({
  staticData: { chrome: 'tabs', tab: 'home' } satisfies RouteChrome,
  component: OnboardScreen,
})

function OnboardScreen() {
  const { tripId } = Route.useParams()
  const { t, type, status } = useI18n()
  const toast = useToast()
  const trip = getTrip(tripId)

  /* Coach link for a WhatsApp group: the code carries no PNR, name or berth
     number, so the link itself is safe to share (rule 13). */
  async function copyCoachLink() {
    const link = inviteLink(createInvite('board', tripId))
    try {
      await navigator.clipboard.writeText(link)
      toast.show(t('share.copied'))
    } catch {
      toast.show(link)
    }
  }

  if (!trip) {
    return (
      <div>
        <Card>
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/">{t('nav.home')}</Link>
        </Button>
      </div>
    )
  }

  const neighbours = listTrips().filter(
    (other) =>
      other.id !== trip.id &&
      other.open_to_swap &&
      other.train_no === trip.train_no &&
      other.journey_date === trip.journey_date &&
      other.passengers[0]?.status === 'CNF',
  )

  /* Design 7a's "Live" chip is honest only while the journey is. The board is
     scoped to "until your stop", so before the train departs or after it has
     arrived there is nothing live to show, and a chip that says Live anyway is
     the exact small lie this screen must not tell. Judged in local time
     because "now" for a traveller is their own clock; `journey_date` carries no
     time, so a day of travel is treated as live from 04:00 to 23:59 — the
     window an Indian train journey actually occupies. */
  const started = trip.journey_date ? `${trip.journey_date}T04:00` : null
  const ended = trip.journey_date ? `${trip.journey_date}T23:59` : null
  const now = Date.now()
  const live =
    started !== null && ended !== null && now >= Date.parse(started) && now <= Date.parse(ended)

  return (
    <div>
      <h1 className="text-title text-ink">{t('onboard.title')}</h1>
      {/* Design 7a leads with ONE chip — "● Live · until Bhopal" — then a
          single coach line. Two separate pills read as two separate facts when
          the design means one sentence, so the state and the stop stay in one
          chip. Reuses `onboard.tillStop` on the Updates path and
          `onboard.until` here; the long `onboard.body` sentence moves to the
          foot of the screen, where at the top it pushed the board below the
          fold. */}
      <p className="mt-2">
        <Pill tone={live ? 'primary' : 'neutral'}>
          <span
            aria-hidden
            className={`size-2 rounded-full ${live ? 'bg-primary' : 'bg-line'}`}
          />
          {`${t(live ? 'onboard.live' : 'onboard.notLive')} · ${t('onboard.until', {
            stop: trip.to_code || trip.train_no,
          })}`}
        </Pill>
      </p>
      <p className="mt-1 text-body text-ink">
        {[
          t('trip.coach', { coach: trip.passengers[0]?.coach ?? '' }),
          trip.train_name || t('train.title', { n: trip.train_no }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <Card className="mt-4 border-primary/30 bg-wash">
        <CardTitle>{t('onboard.youHere')}</CardTitle>
        <CardBody className="text-ink">
          {[
            trip.train_no,
            trip.passengers[0]?.coach ?? '',
            trip.passengers[0] ? type(trip.passengers[0].berth_type) : '',
            trip.passengers[0] ? status(trip.passengers[0].status) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </CardBody>
        <Pill tone={trip.open_to_swap ? 'primary' : 'neutral'}>
          {trip.open_to_swap ? t('home.openToSwap') : t('home.notOpen')}
        </Pill>
      </Card>

      <section className="mt-4 space-y-2">
        {neighbours.map((other) => {
          const passenger = other.passengers[0]
          return (
            <div
              key={other.id}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash font-head font-bold text-primary">
                {passenger?.coach?.slice(0, 2) ?? '·'}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {passenger?.coach ?? '—'} · {passenger ? type(passenger.berth_type) : ''}
                </b>
                <small className="block text-caption text-muted">{t('onboard.onlyOpen')}</small>
              </span>
              <Button size="sm" asChild>
                <Link to="/request/new" search={{ tripId: trip.id }}>
                  {t('onboard.ask')}
                </Link>
              </Button>
            </div>
          )
        })}
      </section>

      {neighbours.length === 0 ? (
        <Card className="mt-4">
          <CardBody>{t('onboard.empty')}</CardBody>
        </Card>
      ) : null}

      <Button className="mt-4" variant="outline" onClick={copyCoachLink}>
        <Link2 aria-hidden className="size-5" />
        {t('onboard.shareLink')}
      </Button>

      <p className="mt-4 text-caption text-muted">{t('onboard.body')}</p>
    </div>
  )
}