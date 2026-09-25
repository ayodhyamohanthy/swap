import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

/* Screen 12 "Google sign-in" (design 3b, no tab bar).
   Google is the only sign-in SeatSwap will ever offer (rule 8). Google OAuth is
   wired in build step 3; until then this screen explains when sign-in is asked
   for, and trips keep working on the device. */

export const Route = createFileRoute('/signin')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: SignInScreen,
})

function SignInScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <h1 className="mt-6 text-title text-ink">{t('signin.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('signin.body')}</p>

      <Button className="mt-6" disabled aria-disabled="true">
        {t('signin.google')}
      </Button>
      <p className="mt-2 text-center text-caption text-muted">{t('signin.notReady')}</p>
      <p className="mt-4 text-body text-muted">{t('signin.note')}</p>

      <Button variant="ghost" className="mt-2" onClick={() => navigate({ to: '/' })}>
        {t('signin.later')}
      </Button>
    </div>
  )
}
