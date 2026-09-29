import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { resetGroups } from '@/lib/groups'
import { resetInvites } from '@/lib/invites'
import { resetOutbox } from '@/lib/outbox'
import { resetRequests } from '@/lib/requests'
import { resetBlocks } from '@/lib/safety'
import { resetStore } from '@/lib/store'

/* Screen 62 "Delete account" (design 22b). Wipes every local-first module on
   this device — trips, activity log, wallet, seen flags, settings, requests,
   family trips, share codes, chat outbox and blocks — then lands on `/goodbye`.
   Deleting is irreversible, so the destructive button asks first. */

export const Route = createFileRoute('/profile/delete')({
  staticData: { chrome: 'tabs', tab: 'profile', back: true } satisfies RouteChrome,
  component: DeleteAccountScreen,
})

function DeleteAccountScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()

  function wipeEverything() {
    resetStore()
    resetRequests()
    resetGroups()
    resetInvites()
    resetBlocks()
    resetOutbox()
    navigate({ to: '/goodbye' })
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('delete.title')}</h1>

      <Card className="mt-4 border-danger/30 bg-danger-soft">
        <span className="flex size-12 items-center justify-center rounded-full bg-card text-danger">
          <Trash2 aria-hidden className="size-6" />
        </span>
        <CardTitle className="mt-2">{t('delete.title')}</CardTitle>
        <CardBody className="mt-1 text-ink">{t('delete.body')}</CardBody>
      </Card>

      <Button className="mt-4" variant="danger" onClick={wipeEverything}>
        {t('delete.confirm')}
      </Button>
      <Button className="mt-2" variant="ghost" onClick={() => navigate({ to: '/profile' })}>
        {t('delete.back')}
      </Button>

      <AppFooter />
    </div>
  )
}
