import { Link, createFileRoute } from '@tanstack/react-router'
import { Coins, ShieldCheck } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { incomingFor, respondToIncoming } from '@/lib/requests'
import { getTrip, isSeen } from '@/lib/store'
import { useRequestsState } from '@/lib/use-store'

/* Screen 32 "Swap request (acceptor)" + 35 "Waiting for payment" (design 4a,
   19c) + "someone was faster" (20a). The acceptor NEVER pays (rule 3) and
   earns nothing until the swap is done (rule 5). Sign-in is asked on the
   first accept (rule 8). */

export const Route = createFileRoute('/incoming/$id')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: IncomingScreen,
})

function IncomingScreen() {
  const { id } = Route.useParams()
  const { t, type } = useI18n()
  const toast = useToast()
  useRequestsState()
  const incoming = incomingFor(id)
  const trip = getTrip(id)

  if (!incoming || !trip) {
    return (
      <div>
        <Card>
          <CardTitle>{t('swaps.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/">{t('nav.home')}</Link>
        </Button>
      </div>
    )
  }

  const accept = () => {
    if (!isSeen('signin_asked')) {
      window.location.assign(
        `/signin?redirect=${encodeURIComponent(`/incoming/${incoming.trip_id}`)}`,
      )
      return
    }
    respondToIncoming(incoming.trip_id, 'accepted')
    toast.show(t('incoming.accepted'))
  }

  const state = incoming.state

  /* Design 20a: someone else paid first — standalone screen, still open. */
  if (state === 'faster') {
    return (
      <div>
        <h1 className="mt-2 text-center text-title text-ink">{t('incoming.fasterTitle')}</h1>
        <p className="mt-1 text-center text-body text-muted">{t('incoming.fasterPaid')}</p>
        <Card className="mt-4">
          <CardBody className="font-semibold text-ink">{t('incoming.fasterOpen')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps">{t('outcome.seeRequests')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('incoming.title')}</h1>
      <p className="mt-1 text-body font-semibold text-ink">
        {t('incoming.giveGet', {
          yours: type(incoming.give_berth),
          theirs: type(incoming.get_berth),
        })}
      </p>

      <Card className="mt-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-wash font-head text-title font-bold text-primary">
          {incoming.requester_name.slice(0, 1)}
        </span>
        <CardTitle className="mt-2">{incoming.requester_name}</CardTitle>
        <CardBody>
          {t('incoming.reason', { reason: t(incoming.reason_key ?? 'request.reasons.none') })}
        </CardBody>
        <p className="mt-2 flex items-center gap-2 font-head text-body font-bold text-primary">
          <Coins aria-hidden className="size-5" />
          {t('incoming.earn')}
        </p>
        <p className="mt-2 flex gap-2 text-caption text-muted">
          <ShieldCheck aria-hidden className="size-4 shrink-0" />
          {t('incoming.privacy')}
        </p>
      </Card>

      {state === 'none' ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={accept}>{t('incoming.accept')}</Button>
          <Button
            variant="outline"
            onClick={() => {
              respondToIncoming(incoming.trip_id, 'declined')
              toast.show(t('incoming.declined'))
            }}
          >
            {t('incoming.decline')}
          </Button>
        </div>
      ) : null}

      {state === 'accepted' ? (
        <Card className="mt-4 border-accent/40 bg-accent-soft">
          <CardTitle>{t('incoming.accepted')}</CardTitle>
          <CardBody className="text-ink">
            {t('incoming.waiting', { name: incoming.requester_name })}
          </CardBody>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              respondToIncoming(incoming.trip_id, 'backed_out')
              toast.show(t('incoming.backOutDone'))
            }}
          >
            {t('incoming.backOut')}
          </Button>
        </Card>
      ) : null}

      {state === 'declined' ? (
        <Card className="mt-4">
          <CardBody>{t('incoming.declined')}</CardBody>
        </Card>
      ) : null}

      {state === 'backed_out' ? (
        <Card className="mt-4">
          <CardBody>{t('incoming.backOutDone')}</CardBody>
        </Card>
      ) : null}
    </div>
  )
}