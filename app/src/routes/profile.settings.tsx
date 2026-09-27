import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { logActivity, updateSettings } from '@/lib/store'
import { disablePushSubscription, ensurePushSubscription } from '@/lib/push'
import { useSettings } from '@/lib/use-store'

/* Screen 60 "Settings" (design 21c): acceptor filters (docs/04 B2) — women
   only, families only, same coach, pause, max per day. Saved locally and
   synced to the `settings` table after sign-in (docs/02). */

export const Route = createFileRoute('/profile/settings')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: SettingsScreen,
})

function Row({
  title,
  body,
  checked,
  onChange,
}: {
  title: string
  body: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className="flex-1">
        <b className="block font-head text-body text-ink">{title}</b>
        <span className="block text-caption text-muted">{body}</span>
      </span>
      <Switch checked={checked} aria-label={title} onCheckedChange={onChange} />
    </Card>
  )
}

function SettingsScreen() {
  const { t } = useI18n()
  const toast = useToast()
  const settings = useSettings()

  function save(patch: Parameters<typeof updateSettings>[0], message?: string) {
    updateSettings(patch)
    logActivity('settings_changed', patch)
    if (message) toast.show(message)
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('settings.title')}</h1>

      <Row
        title={t('settings.women')}
        body={t('settings.womenBody')}
        checked={settings.women_only}
        onChange={(next) => save({ women_only: next })}
      />
      <Row
        title={t('settings.families')}
        body={t('settings.familiesBody')}
        checked={settings.families_only}
        onChange={(next) => save({ families_only: next })}
      />
      <Row
        title={t('settings.coach')}
        body={t('settings.coachBody')}
        checked={settings.same_coach_only}
        onChange={(next) => save({ same_coach_only: next })}
      />
      <Row
        title={t('settings.pause')}
        body={t('settings.pauseBody')}
        checked={settings.paused}
        onChange={(next) => save({ paused: next })}
      />
      <Row
        title={t('settings.max')}
        body={t('settings.maxBody')}
        checked={settings.max_requests_per_day > 3}
        onChange={(next) => save({ max_requests_per_day: next ? 10 : 3 }, t('settings.saved'))}
      />
      <Row
        title={t('alerts.title')}
        body={t('alerts.note')}
        checked={settings.notify_push}
        onChange={(next) => {
          save({ notify_push: next }, t('settings.saved'))
          /* Push follows the toggle, best-effort and offline-safe. */
          void (next ? ensurePushSubscription() : disablePushSubscription())
        }}
      />
    </div>
  )
}