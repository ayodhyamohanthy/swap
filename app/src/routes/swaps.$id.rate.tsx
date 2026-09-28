import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, offersFor } from '@/lib/requests'
import { rateTrip } from '@/lib/store'
import { demoRequest } from '@/lib/demo-swap'
import { cn } from '@/lib/utils'

/* Screen 46 "Rating" (design 13c): stars + quick chips after a finished swap.
   No free credit is attached to rating — it only helps future matches. */
export const Route = createFileRoute('/swaps/$id/rate')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: RateScreen,
})
const CHIPS = ['rating.friendly', 'rating.onTime', 'rating.helpful'] as const
function RateScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const request = getRequest(id)
  const locked = request ? acceptedOffer(request.id) : undefined
  const name = locked?.acceptor_name ?? demoRequest(id).acceptorName
  const [stars, setStars] = useState(5)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)
  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  if (done) {
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('rating.thanks')}</CardTitle>
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild>
              <Link to="/swaps/$id/share" params={{ id }}>
                {t('confirm.share')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/">{t('confirm.addTrip')}</Link>
            </Button>
          </div>
        </Card>
        <AppFooter />
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('rating.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('rating.sub', { name })}</p>
      <div className="mt-4 flex justify-center gap-2" role="radiogroup" aria-label={t('rating.title')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={stars === n}
            aria-label={`${n} / 5`} onClick={() => setStars(n)}
            className={cn(
              'flex min-h-12 min-w-12 items-center justify-center rounded-btn border text-title',
              stars >= n ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card text-muted',
            )}
          >
            <span aria-hidden>★</span>
          </button>
        ))}
      </div>
      <div className="chip-row mt-4 justify-center">
        {CHIPS.map((key) => (
          <button
            key={key} type="button" aria-pressed={picked.has(key)} onClick={() => toggle(key)}
            className={picked.has(key)
              ? 'min-h-12 shrink-0 rounded-full border border-primary bg-wash px-4 font-semibold text-primary'
              : 'min-h-12 shrink-0 rounded-full border border-line bg-card px-4 font-semibold text-ink'}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <Button
        className="mt-4"
        onClick={() => {
          /* Stars land on the other traveller's trip and nudge their future
             match scores (docs/08). No money, no names attached. */
          try {
            const req = getRequest(id)
            const offer = req
              ? offersFor(req.id).find((o) => o.id === req.locked_offer_id) ?? acceptedOffer(req.id)
              : undefined
            if (offer?.acceptor_trip_id) rateTrip(offer.acceptor_trip_id, stars)
          } catch {
            /* A rating must never block the flow — it is advisory only. */
          }
          setDone(true)
        }}
      >
        {t('rating.done')}
      </Button>
      <CardBody className="mt-2 text-center text-caption text-muted">{t('rating.submit')}</CardBody>
      <AppFooter />
    </div>
  )
}
