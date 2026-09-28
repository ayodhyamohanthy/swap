import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ChevronRight, FileText, Gift, Lock, Plus } from 'lucide-react'
import { useState, useEffect, type FormEvent } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { InstallPrompt } from '@/components/install-prompt'
import { PastTripCard, TripCard } from '@/components/trip-card'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { trackEvent } from '@/lib/analytics'
import { useI18n } from '@/lib/i18n'
import { isValidPnr } from '@/lib/pnr'
import { isPastTrip, isSeen, localDateKey, tripsNewestFirst, tripWasSwapped } from '@/lib/store'
import { useCreditPaise, useRequestsState, useTrips } from '@/lib/use-store'

/* Screen 1 "First open" (design 25a), screen 4 "Home · my trips" (1a) and
   screen 55 "Welcome back" (11a) — the third state, for a traveller whose
   journeys are all in the past. PNR entry works signed out; sign-in is only
   asked when a request is sent or accepted (AGENTS.md 8). */

export const Route = createFileRoute('/')({
  staticData: {
    chrome: 'tabs',
    tab: 'home',
    /* Designs 11a and 25a draw a bell to /updates on Home; 1a's older gear
       retires (it only ever linked to /profile, and Profile has its own
       settings rows). */
    showUpdates: true,
    /* Design 1a puts the strapline under the wordmark on Home. */
    tagline: true,
  } satisfies RouteChrome,
  beforeLoad: () => {
    /* First open only: language, then the one-time note. Skipped while the
       shell is prerendered (no localStorage on the server). */
    if (typeof window === 'undefined') return
    if (!isSeen('language')) throw redirect({ to: '/welcome/language' })
    if (!isSeen('note')) throw redirect({ to: '/welcome/note' })
  },
  component: HomeScreen,
})

function HomeScreen() {
  const { t } = useI18n()
  const trips = useTrips()
  const creditPaise = useCreditPaise()
  const { requests, offers } = useRequestsState()
  const navigate = useNavigate()
  const [pnr, setPnr] = useState('')
  const [error, setError] = useState<string | null>(null)

  /* First-screen metric, once per session (docs/08 growth loops). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.sessionStorage.getItem('seatswap.first-screen')) return
      window.sessionStorage.setItem('seatswap.first-screen', '1')
    } catch {
      /* private mode */
    }
    trackEvent('first_screen_viewed', {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitQuickPnr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const digits = pnr.replace(/\D/g, '')
    if (!isValidPnr(digits)) {
      setError(t('add.errPnr'))
      return
    }
    setError(null)
    navigate({ to: '/trips/add', search: { pnr: digits } })
  }

  /* THREE HOMES, one per design state (docs/05):

     1a "Home · my trips" — a journey is still ahead: the list, plus the FAB.
     11a "Welcome back" (screen 55) — every journey is in the past: the credit
        card, "Add your next PNR", and the "Past trips" list with what
        actually happened on each journey.
     25a "First open" — no trips at all: the pitch.

     The split is on journey_date, not on trip count. A traveller whose trips
     are all behind them used to get the 1a list — "Your trips" with nothing
     upcoming in it. The branch order (list, then past, then pitch) IS the
     behaviour: rendering the pitch above a list is what once pushed "Your
     trips" below the fold on a 360 px phone. Today counts as upcoming, and a
     null date is never guessed into history. */
  const todayKey = localDateKey()
  const upcoming = trips.filter((trip) => !isPastTrip(trip, todayKey))
  const past = tripsNewestFirst(trips.filter((trip) => isPastTrip(trip, todayKey)))

  return (
    <div>
      {upcoming.length > 0 ? (
        <>
          {creditPaise > 0 ? (
            <Card className="mb-4 flex items-center gap-3 border-accent/40 bg-accent-soft">
              <Gift aria-hidden className="size-6 shrink-0 text-accent" />
              <span className="flex-1">
                <b className="block font-head text-section text-ink">{t('home.welcomeBack')}</b>
                <span className="block text-caption text-ink">
                  {t('home.creditLine', { amount: Math.round(creditPaise / 100) })}
                </span>
                <span className="block text-caption text-muted">{t('home.creditNever')}</span>
              </span>
            </Card>
          ) : null}

          <section>
            <CardTitle className="mb-2">{t('home.trips')}</CardTitle>
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </section>

          <InstallPrompt />
          <AppFooter />
        </>
      ) : past.length > 0 ? (
        <>
          <h1 className="text-title text-ink">{t('home.welcomeBack')}</h1>

          {/* Design 11a draws the credit card as a link, so it says so. */}
          {creditPaise > 0 ? (
            <Link
              to="/profile"
              className="mt-3 flex items-center gap-3 rounded-card border border-accent/40 bg-accent-soft p-3"
            >
              <Gift aria-hidden className="size-6 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <b className="block font-head text-section text-ink">
                  {t('home.creditLine', { amount: Math.round(creditPaise / 100) })}
                </b>
                <span className="block text-caption text-muted">{t('home.creditNever')}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
            </Link>
          ) : null}

          <Button className="mt-4" asChild>
            <Link to="/trips/add">
              <Plus aria-hidden className="size-5" />
              {t('home.addNextPnr')}
            </Link>
          </Button>

          <section className="mt-5">
            <CardTitle className="mb-2">{t('home.pastTrips')}</CardTitle>
            {past.map((trip) => (
              <PastTripCard
                key={trip.id}
                trip={trip}
                swapped={tripWasSwapped(trip.id, requests, offers)}
              />
            ))}
          </section>

          <InstallPrompt />
          <AppFooter />
        </>
      ) : (
        <>
          <h1 className="text-title text-ink">{t('first.title')}</h1>
          <p className="mt-1 text-body text-muted">{t('first.coreValue')}</p>

          <form className="mt-4" onSubmit={submitQuickPnr} noValidate>
            <Field label={t('first.pnrLabel')} htmlFor="home-pnr" error={error}>
              <Input
                id="home-pnr"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={pnr}
                placeholder={t('first.pnrPlaceholder')}
                onChange={(event) => {
                  setPnr(event.target.value.replace(/\D/g, '').slice(0, 10))
                  setError(null)
                }}
              />
            </Field>
            <Button type="submit">{t('first.find')}</Button>
          </form>

          <p className="mt-3 flex items-center justify-center gap-2">
            <Link
              to="/trips/add"
              search={{ paste: 'sms' }}
              className="inline-flex min-h-12 items-center gap-2 font-semibold text-primary"
            >
              <FileText aria-hidden className="size-5" />
              {t('first.paste')}
            </Link>
          </p>
          <p className="flex items-center justify-center gap-1.5 text-caption text-muted">
            <Lock aria-hidden className="size-4" />
            {t('first.noSignin')}
          </p>

          <Link
            to="/trips/add"
            className="mt-4 flex min-h-16 items-center gap-3 rounded-card border border-accent/40 bg-accent-soft p-3"
          >
            <Gift aria-hidden className="size-6 shrink-0 text-accent" />
            <b className="flex-1 font-head text-body text-ink">{t('first.hint')}</b>
            {/* Design 25a: the ₹50 card is a link, and says so. */}
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
          </Link>

          <InstallPrompt />
          <AppFooter />
        </>
      )}

      {/* Floating action button from design 1a — only while a journey is
          ahead; the 11a screen carries its own "Add your next PNR" button. */}
      {upcoming.length > 0 ? (
        <Link
          to="/trips/add"
          className="fixed bottom-20 right-4 z-30 flex flex-col items-center gap-1 md:right-[calc(50%_-_17rem_+_1rem)]"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-ink shadow-soft">
            <Plus aria-hidden className="size-7" />
          </span>
          <span className="rounded-full bg-card px-2 py-0.5 font-head text-caption font-bold text-primary">
            {t('home.addPnr')}
          </span>
        </Link>
      ) : null}
    </div>
  )
}
