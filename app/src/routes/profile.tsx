import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import {
  Bell,
  Coins,
  Globe,
  HelpCircle,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Type,
  User,
} from 'lucide-react'
import { AppFooter } from '@/components/app-shell'
import { Card, CardBody } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { LANGUAGES, useI18n } from '@/lib/i18n'
import { useCreditPaise, useTrips } from '@/lib/use-store'

/* Screen 57 "Profile & credit" (design 5c). Credit is only ever read here in
   steps 1-2: it stays ₹0 until a swap is confirmed as done (rules 3-6). */

export const Route = createFileRoute('/profile')({
  component: ProfileLayout,
})

/** Layout: the profile screen renders at the index route; settings / help /
   payments / easy / delete render here instead of being swallowed. */
function ProfileLayout() {
  return <Outlet />
}
export function ProfileScreen() {
  const { t, lang, easy, setEasy } = useI18n()
  const creditPaise = useCreditPaise()
  const trips = useTrips()

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

        <Link
          to="/profile/easy"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <Type aria-hidden className="size-5" />
          </span>
          <span className="flex-1">
            <span className="block text-body text-ink">{t('profile.easy')}</span>
            <span className="block text-caption text-muted">{t('profile.easyBody')}</span>
          </span>
          <Switch checked={easy} aria-label={t('profile.easy')} onCheckedChange={setEasy} />
        </Link>

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

        <Link
          to="/profile/payments"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <Receipt aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.payments')}</span>
        </Link>

        <Link
          to="/profile/settings"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <SlidersHorizontal aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.settings')}</span>
        </Link>

        <Link
          to="/profile/help"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-primary">
            <HelpCircle aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-ink">{t('profile.help')}</span>
        </Link>

        <Link
          to="/profile/delete"
          className="flex min-h-14 items-center gap-3 border-b border-line px-4"
        >
          <span className="text-danger">
            <Trash2 aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-body text-danger">{t('profile.delete')}</span>
        </Link>
      </div>

      <p className="mt-4 text-caption text-muted">{t('profile.dataNote')}</p>

      <AppFooter />
    </div>
  )
}
