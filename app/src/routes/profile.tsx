import { Link, createFileRoute } from '@tanstack/react-router'
import { Bell, Coins, Globe, HelpCircle, ShieldCheck, User } from 'lucide-react'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { LANGUAGES, useI18n } from '@/lib/i18n'
import { useCreditPaise, useTrips } from '@/lib/use-store'

/* Screen 57 "Profile & credit" (design 5c). Credit is only ever read here in
   steps 1-2: it stays ₹0 until a swap is confirmed as done (rules 3-6). */

export const Route = createFileRoute('/profile')({
  staticData: { chrome: 'tabs', tab: 'profile' } satisfies RouteChrome,
  component: ProfileScreen,
})

function ProfileScreen() {
  const { t, lang, easy, setEasy } = useI18n()
  const creditPaise = useCreditPaise()
  const trips = useTrips()
  const [showHelp, setShowHelp] = useState(false)

  const languageName = LANGUAGES.find((option) => option.code === lang)?.native ?? 'English'

  return (
    <div>
      <h1 className="text-title text-ink">{t('profile.title')}</h1>

      <Card className="mt-3 flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-wash text-primary">
          <User aria-hidden className="size-7" />
        </span>
        <span>
          <b className="block font-head text-section text-ink">{t('profile.guest')}</b>
          <span className="block text-caption text-muted">{t('profile.signInNote')}</span>
        </span>
      </Card>

      <Card className="mt-3 border-primary/30 bg-wash">
        <span className="flex items-center gap-2">
          <Coins aria-hidden className="size-5 text-accent" />
          <b className="font-head text-section text-ink">{t('profile.credit')}</b>
        </span>
        <p className="mt-1 font-head text-title text-primary">
          {t('profile.balance', { amount: Math.round(creditPaise / 100) })}
        </p>
        <CardBody className="text-ink">
          {creditPaise > 0 ? t('profile.creditBody') : t('profile.noCredit')}
        </CardBody>
      </Card>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-card">
        <Link to="/" className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <span className="text-primary">
            <User aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.myTrips')}</span>
          <span className="text-caption text-muted">{trips.length}</span>
        </Link>

        <Link
          to="/welcome/language"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <Globe aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.language')}</span>
          <span className="text-caption text-muted">{languageName}</span>
        </Link>

        <div className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <span className="text-primary">
            <span aria-hidden className="font-head text-section">
              Aa
            </span>
          </span>
          <span className="flex-1">
            <span className="block text-body text-ink">{t('profile.easy')}</span>
            <span className="block text-caption text-muted">{t('profile.easyBody')}</span>
          </span>
          <Switch checked={easy} aria-label={t('profile.easy')} onCheckedChange={setEasy} />
        </div>

        <Link
          to="/welcome/alerts"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <Bell aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.alerts')}</span>
        </Link>

        <Link to="/welcome/privacy" className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <span className="text-primary">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('privacy.title')}</span>
        </Link>

        <Button
          variant="ghost"
          className="min-h-14 justify-start rounded-none px-4 font-body text-body font-normal"
          onClick={() => setShowHelp((open) => !open)}
        >
          <span className="text-primary">
            <HelpCircle aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-left text-ink">{t('profile.help')}</span>
        </Button>
      </div>

      {showHelp ? (
        <Card className="mt-3">
          <CardTitle>{t('profile.help')}</CardTitle>
          <CardBody>{t('profile.helpBody')}</CardBody>
        </Card>
      ) : null}

      <p className="mt-4 text-caption text-muted">{t('profile.dataNote')}</p>

      <AppFooter />
    </div>
  )
}
