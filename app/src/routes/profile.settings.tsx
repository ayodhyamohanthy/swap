import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { consentGranted, setConsent, startForwarding } from '@/lib/posthog'
import {
  clampMaxRequestsPerDay,
  logActivity,
  MAX_REQUESTS_PER_DAY_MAX,
  MAX_REQUESTS_PER_DAY_MIN,
  updateSettings,
} from '@/lib/store'
import { disablePushSubscription, ensurePushSubscription } from '@/lib/push'
import { useSettings } from '@/lib/use-store'

/* Screen 60 "Settings" (design 21c): acceptor filters (docs/04 B2) — women
   only, families only, same coach, pause, max per day. Saved locally and
   synced to the `settings` table after sign-in (docs/02). */

export const Route = createFileRoute('/profile/settings')({
  staticData: { chrome: 'tabs', tab: 'profile' } satisfies RouteChrome,
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
  /* Read from storage, not from `settings`, because consent lives with the
     forwarder and must not be part of the synced acceptor-filter settings (a
     traveller who opted out on this device should not have it follow them to
     a new account). */
  const [analyticsOn, setAnalytics] = useState(consentGranted)

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
      {/* docs/04 B2 makes the daily cap a number (docs/03 default 3), so it
          is a stepper, not a switch: the copy asks "how many", and an on/off
          that quietly meant 3-or-10 could never answer it. */}
      <Card className="flex items-center gap-3">
        <span className="flex-1">
          <b className="block font-head text-body text-ink">{t('settings.max')}</b>
          <span className="block text-caption text-muted">{t('settings.maxBody')}</span>
        </span>
        <span className="flex items-center gap-1">
          <Button
            variant="neutral"
            size="icon"
            aria-label={t('settings.maxFewer')}
            disabled={settings.max_requests_per_day <= MAX_REQUESTS_PER_DAY_MIN}
            onClick={() =>
              save(
                { max_requests_per_day: clampMaxRequestsPerDay(settings.max_requests_per_day - 1) },
                t('settings.saved'),
              )
            }
          >
            −
          </Button>
          <b
            className="w-7 text-center font-head text-section text-ink"
            aria-live="polite"
            aria-atomic="true"
          >
            {settings.max_requests_per_day}
          </b>
          <Button
            variant="neutral"
            size="icon"
            aria-label={t('settings.maxMore')}
            disabled={settings.max_requests_per_day >= MAX_REQUESTS_PER_DAY_MAX}
            onClick={() =>
              save(
                { max_requests_per_day: clampMaxRequestsPerDay(settings.max_requests_per_day + 1) },
                t('settings.saved'),
              )
            }
          >
            +
          </Button>
        </span>
      </Card>
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
      <Row
        title={t('settings.analytics')}
        body={t('settings.analyticsBody')}
        checked={analyticsOn}
        onChange={(next) => {
          setConsent(next)
          /* Re-read from storage rather than trusting `next`, so the switch can
             never show a state the forwarder does not have. */
          setAnalytics(consentGranted())
          if (consentGranted()) startForwarding()
          if (!next) toast.show(t('settings.analyticsOff'))
        }}
      />
    </div>
  )
}