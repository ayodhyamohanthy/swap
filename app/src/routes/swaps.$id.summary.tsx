import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { TicketCard } from '@/components/ticket-card'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, offersFor, revealedBerths } from '@/lib/requests'
import { getTrip } from '@/lib/store'

/* Swap summary — the offline ticket stub (docs/04 A12, design 9c) + footer.
   Every value comes from the real locked request: the train, the date, and
   the two exact berths (rule 13: revealed only after payment). Nothing here
   is fabricated — unknown berths render masked ("Berth ••"), never guessed.
   Design 9c draws this as a kept ticket: green header, the berth pair, an
   explicit "works without network" badge, then the tear and the stub. */
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
  /* The ticket's hero line needs both berth numbers; without them (not locked
     yet, or an older offline record) fall back to the give/get wording so the
     numbers are never guessed. */
  const pair =
    berths?.coach && berths.mineNo && berths.theirsNo
      ? t('summary.berths', { coach: berths.coach, mine: berths.mineNo, theirs: berths.theirsNo })
      : `${t('summary.youGive', { berth: berths?.mine ?? masked })} · ${t('summary.youGet', { berth: berths?.theirs ?? masked })}`

  return (
    <div>
      <TicketCard
        brand={t('brand.wordmark')}
        tagline={t('summary.tagline')}
        title={t('summary.title')}
        headline={pair}
        subline={t('summary.train', {
          n: trainLabel,
          date: trip.journey_date ? date(trip.journey_date) : '—',
        })}
        offlineLabel={t('summary.offlinePill')}
        stubTitle={t('footer.line1')}
        stubBody={t('footer.line2')}
      >
        {locked ? (
          <p className="mt-3 text-center text-caption text-muted">
            {t('summary.met', { name: locked.acceptor_name })} · {type(locked.acceptor_berth_type)}
          </p>
        ) : null}
      </TicketCard>
      {berths ? (
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id/meet" params={{ id }}>
            {t('meet.title')}
          </Link>
        </Button>
      ) : null}
      <Button className="mt-2" variant="outline" asChild>
        <Link to="/swaps/$id/confirm" params={{ id }}>
          {t('confirm.title')}
        </Link>
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/swaps/$id/cancel" params={{ id }}>
          {t('cancelSwap.title')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
