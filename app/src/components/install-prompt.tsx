import { useEffect, useState } from 'react'
import { Share2, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { useTrips } from '@/lib/use-store'
import { trackEvent } from '@/lib/analytics'

/* Install prompt (docs/08): a gentle card, never a modal. It only appears once
   a PNR has been added (there is something to keep offline) and only when the
   browser actually offers `beforeinstallprompt`, so it never dead-ends. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Module-level so the event is captured before this card mounts. */
let deferred: BeforeInstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    window.dispatchEvent(new Event('seatswap:installable'))
  })
}

const DISMISS_KEY = 'seatswap.install.dismissed.v1'

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function InstallPrompt() {
  const { t } = useI18n()
  const trips = useTrips()
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (dismissed() || deferred === null) return
    if (trips.length === 0) return
    setAvailable(true)
  }, [trips.length])

  if (!available) return null

  async function install() {
    const event = deferred
    deferred = null
    setAvailable(false)
    if (!event) return
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') trackEvent('install_prompt_accepted', {})
  }

  function later() {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* private mode */
    }
    setAvailable(false)
  }

  return (
    <Card className="mt-4 border-primary/30 bg-wash">
      <CardTitle className="flex items-center gap-2">
        <Smartphone aria-hidden className="size-5 text-primary" />
        {t('growth.installTitle')}
      </CardTitle>
      <CardBody className="mt-1 text-ink">{t('growth.installBody')}</CardBody>
      <div className="mt-3 flex gap-2">
        <Button onClick={install}>
          <Share2 aria-hidden className="size-5" />
          {t('growth.install')}
        </Button>
        <Button variant="ghost" size="sm" onClick={later} aria-label={t('growth.dismiss')}>
          <X aria-hidden className="size-5" />
          {t('growth.dismiss')}
        </Button>
      </div>
    </Card>
  )
}
