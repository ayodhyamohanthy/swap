import { Link, Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { WifiOff } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { answerSwap } from '@/lib/settle'
import { getRequest } from '@/lib/requests'
import { listTrips } from '@/lib/store'

/* Did you swap — design 4c: one primary "Yes, we swapped" and one secondary
   "Something went wrong". The Yes records the answer straight away; the
   second opens screen 47 (design 6b), whose four reasons carry the other
   three answers of docs/04 A13 ("Other person didn't come / Swap wasn't
   possible / We changed our mind") plus the railway-berth case. Together the
   two screens keep the full answer set docs/09 lists for Did-you-swap. */
export const Route = createFileRoute('/swaps/$id/confirm')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ConfirmScreen,
})

function ConfirmScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  /* Keyed to the request: the router keeps this component mounted when only
     the $id segment changes, so a bare boolean would show one swap's waiting
     card on the next swap's question. */
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  const request = getRequest(id)
  /* Only locked swaps take answers; anything else is a wrong turn here. */
  if (!request || request.status !== 'locked') {
    return <Navigate to="/swaps" />
  }
  if (waitingFor === id) {
    return (
      <div>
        <Card className="mt-4">
          <CardBody>{t('confirm.saved')}</CardBody>
          <CardBody>{t('confirm.sub')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id/summary" params={{ id }}>{t('summary.title')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  function yes() {
    if (!request) return
    /* Whose answer is this? Whoever holds this trip on this device is
       the requester; otherwise we are the acceptor. */
    const side = listTrips().some((trip) => trip.id === request.trip_id) ? 'requester' : 'acceptor'
    const result = answerSwap(id, side, 'swapped')
    const status = result.resolution?.status
    if (status === 'confirmed') {
      /* The acceptor's confirmation earns the ₹50 thank-you credit, so
         they land on the earned screen and the requester on "you swapped". */
      navigate({
        to: '/swaps/$id/done',
        params: { id },
        search: { state: side === 'acceptor' ? 'earned' : 'swapped' },
      })
    } else if (status === 'voided') {
      navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'credit' } })
    } else if (status === 'disputed') {
      navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'review' } })
    } else {
      /* The other side has not answered yet; money moves only when both
         agree (or the 12h auto-confirm). The answer itself is saved. */
      setWaitingFor(id)
    }
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('confirm.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('confirm.sub')}</p>
      <Button className="mt-4" onClick={yes}>
        {t('confirm.yes')}
      </Button>
      <Button className="mt-2" variant="outline" asChild>
        <Link to="/swaps/$id" params={{ id }} search={{ view: 'problem' }}>
          {t('outcome.problemTitle')}
        </Link>
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-caption text-muted">
        <WifiOff aria-hidden className="size-4 shrink-0" />
        {t('summary.offlinePill')}
      </p>
      <AppFooter />
    </div>
  )
}
