import { Link, createFileRoute } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

/* Screen 63 "Account deleted" (design 22c). A bare confirmation — no tab bar,
   no upsell. Adding a PNR again is always allowed and still needs no sign-in. */

export const Route = createFileRoute('/goodbye')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: GoodbyeScreen,
})

function GoodbyeScreen() {
  const { t } = useI18n()

  return (
    <div className="app-column text-center">
      <p className="font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <span className="mx-auto mt-10 flex size-20 items-center justify-center rounded-full bg-wash text-primary">
        <ShieldCheck aria-hidden className="size-10" />
      </span>
      <h1 className="mt-4 text-title text-ink">{t('goodbye.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('goodbye.body')}</p>

      <Button className="mt-6" asChild>
        <Link to="/">{t('goodbye.home')}</Link>
      </Button>
      <p className="mt-4 text-caption text-muted">{t('footer.line2')}</p>
    </div>
  )
}
