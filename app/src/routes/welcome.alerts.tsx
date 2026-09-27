import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { logActivity, markSeen, updateSettings } from '@/lib/store'
import { ensurePushSubscription } from '@/lib/push'

/* Screen 14 "Turn on alerts" (design 10c). Alerts are free web push (no SMS,
   rule 15) and are only asked for after the first request (docs/08), so this
   screen saves the intent instead of prompting for permission. */

export const Route = createFileRoute('/welcome/alerts')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AlertsScreen,
})

function AlertsScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()

  function turnOn() {
    markSeen('alerts')
    updateSettings({ alerts_intent: true, notify_push: true })
    logActivity('alerts_intent', { on: true })
    /* Best-effort: without a VAPID key or permission this quietly no-ops and
       the in-app Updates list remains the channel (docs/08). */
    void ensurePushSubscription()
    toast.show(t('alerts.saved'))
    navigate({ to: '/' })
  }

  function notNow() {
    markSeen('alerts')
    logActivity('alerts_intent', { on: false })
    navigate({ to: '/' })
  }

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <span className="mx-auto mt-6 flex size-24 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Bell aria-hidden className="size-12" />
      </span>
      <h1 className="mt-4 text-center text-title text-ink">{t('alerts.title')}</h1>
      <p className="mt-1 text-center text-body text-muted">{t('alerts.body')}</p>

      <Button className="mt-8" onClick={turnOn}>
        {t('alerts.on')}
      </Button>
      <Button variant="ghost" className="mt-1" onClick={notNow}>
        {t('alerts.later')}
      </Button>
      <p className="mt-6 text-center text-caption text-muted">{t('alerts.note')}</p>
    </div>
  )
}
