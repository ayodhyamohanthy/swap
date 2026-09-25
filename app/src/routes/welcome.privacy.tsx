import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { logActivity, markSeen, updateSettings } from '@/lib/store'

/* Screen 13 "Privacy" (design 11b). Also asked right before the first request
   in step 4; until then it is reachable from Profile. */

export const Route = createFileRoute('/welcome/privacy')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: PrivacyScreen,
})

function PrivacyScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [agreed, setAgreed] = useState(false)

  function agree() {
    setAgreed(true)
    markSeen('privacy')
    updateSettings({ privacy_consented_at: new Date().toISOString() })
    logActivity('privacy_consented')
    navigate({ to: '/' })
  }

  const rows = [
    { title: t('privacy.pnrNever'), detail: t('privacy.pnrNeverBody') },
    { title: t('privacy.berthHidden'), detail: t('privacy.berthHiddenBody') },
    { title: t('privacy.deleteAnytime'), detail: t('privacy.deleteBody') },
  ]

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <span className="mx-auto mt-6 flex size-20 items-center justify-center rounded-full bg-wash text-primary">
        <ShieldCheck aria-hidden className="size-10" />
      </span>
      <h1 className="mt-4 text-center text-title text-ink">{t('privacy.title')}</h1>
      <p className="mt-1 text-center text-body text-muted">{t('privacy.subtitle')}</p>

      <div className="mt-6 flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-wash text-primary">
              <Check aria-hidden className="size-4" />
            </span>
            <span>
              <b className="block font-head text-body text-ink">{row.title}</b>
              <span className="block text-caption text-muted">{row.detail}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-body text-muted">{t('privacy.body')}</p>

      <Button className="mt-6" onClick={agree} disabled={agreed}>
        {t('privacy.agree')}
      </Button>
      <p className="mt-4 text-center text-caption text-muted">{t('footer.line2')}</p>
    </div>
  )
}
