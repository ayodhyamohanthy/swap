import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { FileText, Gift, Lock, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { InstallPrompt } from '@/components/install-prompt'
import { TripCard } from '@/components/trip-card'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { isValidPnr } from '@/lib/pnr'
import { isSeen } from '@/lib/store'
import { useCreditPaise, useTrips } from '@/lib/use-store'

/* Screen 1 "First open" (design 25a) and screen 4 "Home · my trips" (1a).
   PNR entry works signed out; sign-in is only asked when a request is sent or
   accepted (AGENTS.md 8). */

export const Route = createFileRoute('/')({
  staticData: { chrome: 'tabs', tab: 'home', showSettings: true } satisfies RouteChrome,
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
  const navigate = useNavigate()
  const [pnr, setPnr] = useState('')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div>
      <h1 className="text-title text-ink">{t('first.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('first.coreValue')}</p>

      {creditPaise > 0 ? (
        <Card className="mt-4 flex items-center gap-3 border-accent/40 bg-accent-soft">
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
      </Link>

      {trips.length > 0 ? (
        <section className="mt-6">
          <CardTitle className="mb-2">{t('home.trips')}</CardTitle>
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </section>
      ) : null}

      <InstallPrompt />

      <AppFooter />

      {/* Floating action button from design 1a — only once a trip exists. */}
      {trips.length > 0 ? (
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
