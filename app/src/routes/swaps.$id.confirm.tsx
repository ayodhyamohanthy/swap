import { Link, Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { CONFIRM_OPTIONS, type ConfirmOutcome } from '@/lib/outcomes'
import { answerSwap } from '@/lib/settle'
import { getRequest } from '@/lib/requests'
import { listTrips } from '@/lib/store'

/* Did you swap — 4 options (docs/04 A13, docs/09). */
export const Route = createFileRoute('/swaps/$id/confirm')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ConfirmScreen,
})
const KEY: Record<ConfirmOutcome, 'confirm.yes' | 'confirm.noShow' | 'confirm.notPossible' | 'confirm.changedMind'> = {
  swapped: 'confirm.yes', no_show: 'confirm.noShow',
  not_possible: 'confirm.notPossible', changed_mind: 'confirm.changedMind',
}
function ConfirmScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [picked, setPicked] = useState<ConfirmOutcome | null>(null)
  const [waiting, setWaiting] = useState(false)
  const request = getRequest(id)
  /* Only locked swaps take answers; anything else is a wrong turn here. */
  if (!request || request.status !== 'locked') {
    return <Navigate to="/swaps" />
  }
  if (waiting) {
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
  return (
    <div>
      <h1 className="text-title text-ink">{t('confirm.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('confirm.sub')}</p>
      <Card className="mt-4">
        <div className="flex flex-col gap-2">
          {CONFIRM_OPTIONS.map((o) => (
            <button
              key={o} type="button" onClick={() => setPicked(o)}
              aria-pressed={picked === o}
              className={picked === o
                ? 'min-h-12 rounded-btn border border-primary bg-wash px-4 font-head font-bold text-primary'
                : 'min-h-12 rounded-btn border border-line bg-card px-4 font-head font-bold text-ink'}
            >
              {t(KEY[o])}
            </button>
          ))}
        </div>
        {picked ? <CardBody>{t('confirm.saved')}</CardBody> : null}
      </Card>
      <Button
        className="mt-4"
        disabled={!picked}
        onClick={() => {
          if (!picked || !request) return
          /* Whose answer is this? Whoever holds this trip on this device is
             the requester; otherwise we are the acceptor. */
          const mine = listTrips().some((trip) => trip.id === request.trip_id)
          const result = answerSwap(id, mine ? 'requester' : 'acceptor', picked)
          trackEvent('confirmation', { outcome: picked })
          const status = result.resolution?.status
          if (status === 'confirmed') {
            navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'swapped' } })
          } else if (status === 'voided') {
            navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'credit' } })
          } else if (status === 'disputed') {
            navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'review' } })
          } else {
            /* One side answered; money moves only when both agree (or the
               12h auto-confirm). The answer itself is saved either way. */
            setWaiting(true)
          }
        }}
      >
        {t('confirm.submit')}
      </Button>
      <AppFooter />
    </div>
  )
}
