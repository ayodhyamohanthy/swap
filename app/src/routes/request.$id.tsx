import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, Share2 } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, offersFor, setRequestPaused, withdrawRequest } from '@/lib/requests'
import { getTrip } from '@/lib/store'
import { useSwapRequest } from '@/lib/use-store'

/* Screens 15-17 "Your request / No reply / You're the first" (design 12b, 12c)
   + screen 22 "2nd choice match" (14c). Send is free; payment only after a
   yes (rule 2). */

export const Route = createFileRoute('/request/$id')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ManageRequestScreen,
})

function ManageRequestScreen() {
  const { id } = Route.useParams()
  const { t, type } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const request = useSwapRequest(id)
  const [paused, setPaused] = useState(false)

  if (!request) {
    return (
      <div>
        <Card>
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/">{t('nav.home')}</Link>
        </Button>
      </div>
    )
  }

  const trip = getTrip(request.trip_id)
  const offers = offersFor(request.id)
  const accepted = acceptedOffer(request.id)
  const shareDate = `${trip?.train_no ?? ''}-${trip?.journey_date ?? ''}`
  const searching = request.status === 'searching'
  const awaiting = request.status === 'accepted_awaiting_payment'
  const locked = request.status === 'locked'
  const withdrawn = request.status === 'withdrawn'
  const statusLabel = locked
    ? t('summary.title')
    : withdrawn
      ? t('manage.withdrawn')
      : awaiting
        ? t('manage.acceptedCta')
        : searching
          ? t('matches.sentState')
          : t('manage.status', { status: request.status })

  const togglePause = (next: boolean) => {
    setPaused(next)
    setRequestPaused(request.id, next)
    if (next) toast.show(t('manage.pausedNote'))
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('manage.title')}</h1>
      <div className="mt-1 flex items-center gap-2">
        <Pill tone={awaiting || locked ? 'primary' : 'neutral'}>{statusLabel}</Pill>
        {trip ? <span className="text-caption text-muted">{trip.train_no}</span> : null}
      </div>

      {awaiting && accepted ? (
        <Card className="mt-4 border-accent/40 bg-accent-soft">
          <CardTitle>{t('pay.title', { name: accepted.acceptor_name })}</CardTitle>
          <CardBody className="text-ink">{t('manage.acceptedCta')}</CardBody>
          {accepted.matched_choice_rank > 1 ? (
            <p className="mt-2 text-body text-ink">
              {t('manage.secondTitle')} ·{' '}
              {t('manage.secondBody', {
                name: accepted.acceptor_name,
                berth: type(accepted.acceptor_berth_type),
              })}
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild>
              <Link to="/pay/$requestId" params={{ requestId: request.id }}>
                {t('manage.payCta')}
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRequestPaused(request.id, true)
                setPaused(true)
                toast.show(t('manage.keepWaiting'))
              }}
            >
              {t('manage.keepWaiting')}
            </Button>
          </div>
        </Card>
      ) : null}

      {locked ? (
        <Card className="mt-4 border-primary/30 bg-wash">
          <CardTitle>{t('summary.title')}</CardTitle>
          <CardBody className="text-ink">{t('pay.berthReveal')}</CardBody>
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild>
              <Link to="/swaps/$id/summary" params={{ id: request.id }}>
                {t('summary.title')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/chat/$id" params={{ id: request.id }}>
                {t('chat.title', { name: accepted?.acceptor_name ?? '—' })}
              </Link>
            </Button>
          </div>
        </Card>
      ) : null}

      {searching && offers.length === 0 ? (
        <Card className="mt-4">
          <CardTitle>{t('manage.noReplyTitle')}</CardTitle>
          <CardBody>{t('manage.noReplyBody')}</CardBody>
          <Button className="mt-3" variant="outline" asChild>
            <Link to="/share/$trainDate" params={{ trainDate: shareDate }}>
              <Share2 aria-hidden className="size-5" />
              {t('manage.share')}
            </Link>
          </Button>
          <Button className="mt-2" asChild>
            <Link to="/request/new" search={{ tripId: request.trip_id }}>
              {t('manage.tryAnother')}
            </Link>
          </Button>
        </Card>
      ) : null}

      {searching && offers.length > 0 ? (
        <section className="mt-4 space-y-2">
          {offers.map((offer) => (
            <div
              key={offer.id}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-wash font-head font-bold text-primary">
                {offer.acceptor_name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">{offer.acceptor_name}</b>
                <small className="block text-caption text-muted">
                  {t('matches.choice', { rank: offer.matched_choice_rank })}
                </small>
              </span>
              <Pill tone="neutral">{t('matches.sentState')}</Pill>
            </div>
          ))}
        </section>
      ) : null}

      {withdrawn ? (
        <Card className="mt-4">
          <CardBody>{t('manage.withdrawn')}</CardBody>
          <Button className="mt-3" asChild>
            <Link to="/request/new" search={{ tripId: request.trip_id }}>
              {t('request.title')}
            </Link>
          </Button>
        </Card>
      ) : null}

      {searching ? (
        <>
          <Card className="mt-4 flex items-center gap-3">
            <span className="flex-1">
              <b className="block font-head text-body text-ink">{t('manage.pause')}</b>
              <span className="block text-caption text-muted">{t('manage.pausedNote')}</span>
            </span>
            <Switch checked={paused} aria-label={t('manage.pause')} onCheckedChange={togglePause} />
          </Card>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="outline" asChild>
              <Link to="/request/new" search={{ tripId: request.trip_id }}>
                {t('manage.edit')}
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="justify-start text-danger"
              onClick={() => {
                withdrawRequest(request.id)
                toast.show(t('manage.withdrawn'))
                navigate({ to: '/' })
              }}
            >
              {t('manage.withdraw')}
            </Button>
          </div>
        </>
      ) : null}

      <p className="mt-4 flex gap-2 text-caption text-muted">
        <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
        {t('first.sendFree')}
      </p>
    </div>
  )
}