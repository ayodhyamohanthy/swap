import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftRight, Info } from 'lucide-react'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'
import { FEE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import { setOpenToSwap } from '@/lib/store'
import { useTrips } from '@/lib/use-store'

/* Screen 56 "Swaps list" (design 5b). Requests and matches arrive in build
   step 4; what step 2 already owns is the acceptor side ("I'm open to swap")
   and the money rules, which are shown here so nobody has to guess. */

export const Route = createFileRoute('/swaps')({
  component: SwapsLayout,
})

/** Layout: the list renders at the index route; /$id/* swap screens render here. */
function SwapsLayout() {
  return <Outlet />
}
export function SwapsScreen() {
  const { t, date } = useI18n()
  const trips = useTrips()
  const openTrips = trips.filter((trip) => trip.open_to_swap)

  return (
    <div>
      <h1 className="text-title text-ink">{t('swaps.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('swaps.sub')}</p>

      {trips.length === 0 ? (
        <Card className="mt-4">
          <CardTitle>{t('swaps.empty')}</CardTitle>
          <Button className="mt-3" asChild>
            <Link to="/trips/add">{t('home.addPnr')}</Link>
          </Button>
        </Card>
      ) : null}

      {trips.length > 0 ? (
        <section className="mt-5">
          <CardTitle className="mb-2">{t('swaps.openTitle')}</CardTitle>
          <CardBody className="mb-3">{t('swaps.openSub')}</CardBody>
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="mb-2 flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                <ArrowLeftRight aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {trip.train_name || t('train.title', { n: trip.train_no })}
                </b>
                <small className="block text-caption text-muted">{date(trip.journey_date)}</small>
                <span className="mt-1 inline-flex">
                  <Pill tone={trip.open_to_swap ? 'primary' : 'neutral'}>
                    {trip.open_to_swap ? t('home.openToSwap') : t('home.notOpen')}
                  </Pill>
                </span>
              </span>
              <Switch
                checked={trip.open_to_swap}
                aria-label={t('trip.open')}
                onCheckedChange={(checked) => setOpenToSwap(trip.id, checked)}
              />
            </div>
          ))}
          {openTrips.length === 0 ? (
            <p className="mt-1 text-caption text-muted">{t('swaps.noneOpen')}</p>
          ) : null}
          <p className="mt-2 text-caption text-muted">{t('trip.noReward')}</p>
        </section>
      ) : null}

      <section className="mt-6">
        <CardTitle className="mb-2">{t('swaps.rulesTitle')}</CardTitle>
        <Card>
          <dl className="text-body">
            <div className="flex items-center justify-between gap-3 py-1">
              <dt className="text-muted">{t('swaps.fee')}</dt>
              <dd className="font-head font-bold text-ink">₹{FEE_PAISE / 100}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1">
              <dt className="text-muted">{t('swaps.thankYou')}</dt>
              <dd className="font-head font-bold text-ink">₹{THANK_YOU_PAISE / 100}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-2">
              <dt className="font-head font-bold text-ink">{t('swaps.total')}</dt>
              <dd className="font-head text-title font-bold text-primary">₹{PRICE_PAISE / 100}</dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-2 text-caption text-muted">
            <li>{t('swaps.onlyAfter')}</li>
            <li>{t('swaps.noSwap')}</li>
            <li>{t('swaps.creditRule')}</li>
            <li>{t('swaps.acceptorFree')}</li>
          </ul>
        </Card>
      </section>

      <p className="mt-4 flex gap-2 text-caption text-muted">
        <Info aria-hidden className="size-4 shrink-0" />
        {t('profile.signInNote')}
      </p>

      <AppFooter />
    </div>
  )
}
