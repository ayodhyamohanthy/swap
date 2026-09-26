import { Link, createFileRoute } from '@tanstack/react-router'
import { TrainFront, WifiOff } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest, revealedBerths } from '@/lib/requests'
import { demoRequest } from '@/lib/demo-swap'

/* Screen 38 "Found each other?" (design 13b): after chat, before the Swap
   summary. Both answers lead to the summary — this screen only records that
   the two travellers tried to meet on board. */
export const Route = createFileRoute('/swaps/$id/meet')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: MeetScreen,
})
function MeetScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const request = getRequest(id)
  const locked = request ? acceptedOffer(request.id) : undefined
  const name = locked?.acceptor_name ?? demoRequest(id).acceptorName
  const berths = revealedBerths(id)
  const mine = berths?.mine ?? t('matches.berthMasked')
  return (
    <div>
      <h1 className="text-title text-ink">{t('meet.title')}</h1>
      <Card className="mt-4 border-primary/30 bg-wash">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <TrainFront aria-hidden className="size-6" />
        </span>
        <CardTitle className="mt-2">{t('meet.atBerth', { berth: mine })}</CardTitle>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/swaps/$id/summary" params={{ id }}>
          {t('meet.metYes', { name })}
        </Link>
      </Button>
      <Button className="mt-2" variant="outline" asChild>
        <Link to="/swaps/$id/summary" params={{ id }}>
          {t('meet.metNo')}
        </Link>
      </Button>
      <p className="mt-4 flex items-center justify-center gap-2 text-caption text-muted">
        <WifiOff aria-hidden className="size-4" />
        {t('meet.offline')}
      </p>
      <AppFooter />
    </div>
  )
}
