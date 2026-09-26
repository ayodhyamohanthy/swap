import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, offersFor, revealedBerths } from '@/lib/requests'
import { getTrip } from '@/lib/store'

/* Swap summary — offline-capable card (docs/04 A12, design 9c) + footer.
   Every value comes from the real locked request: the train, the date, and
   the two exact berths (rule 13: revealed only after payment). Nothing here
   is fabricated — unknown berths render masked ("Berth ••"), never guessed. */
export const Route = createFileRoute('/swaps/$id/summary')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: SummaryScreen,
})
function SummaryScreen() {
  const { id } = Route.useParams()
  const { t, date, type } = useI18n()
  const request = getRequest(id)
  const trip = request ? getTrip(request.trip_id) : undefined
  const locked =
    (request ? offersFor(request.id).find((offer) => offer.id === request.locked_offer_id) : undefined) ??
    (request ? acceptedOffer(request.id) : undefined)
  const berths = revealedBerths(id)

  if (!request || !trip) {
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

  const trainLabel = trip.train_name ? `${trip.train_name} ${trip.train_no}` : trip.train_no
  const masked = t('matches.berthMasked')
  return (
    <div>
      <h1 className="text-title text-ink">{t('summary.title')}</h1>
      <p className="mt-1 text-caption text-muted">{t('summary.offline')}</p>
      <Card className="mt-4">
        <CardTitle>
          {t('summary.train', { n: trainLabel, date: trip.journey_date ? date(trip.journey_date) : '—' })}
        </CardTitle>
        <CardBody>
          {t('summary.youGive', { berth: berths?.mine ?? masked })} ·{' '}
          {t('summary.youGet', { berth: berths?.theirs ?? masked })}
          {locked ? (
            <span className="mt-1 block text-caption text-muted">
              {t('chat.title', { name: locked.acceptor_name })} · {type(locked.acceptor_berth_type)}
            </span>
          ) : null}
        </CardBody>
        <p className="mt-2 text-body text-ink">{t('summary.keep')}</p>
      </Card>
      {berths ? (
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id/confirm" params={{ id }}>
            {t('confirm.title')}
          </Link>
        </Button>
      ) : null}
      <AppFooter />
    </div>
  )
}
