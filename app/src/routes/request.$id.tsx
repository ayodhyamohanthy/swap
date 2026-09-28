import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Info, Pause, Pencil, Play, Share2, TrainFront, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { choiceRankKey, requestStatusLabel, useI18n } from '@/lib/i18n'
import { acceptedOffer, offersFor, setRequestPaused, withdrawRequest } from '@/lib/requests'
import { getTrip } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useSwapRequest } from '@/lib/use-store'

/* Screens 15-17 "Your request / No reply / You're the first" (design 12b, 12c)
   + screen 22 "2nd choice match" (14c). Send is free; payment only after a
   yes (rule 2). */

export const Route = createFileRoute('/request/$id')({
  component: RequestLayout,
})

/** Layout: the manage screen renders at the index route; /matches renders here. */
function RequestLayout() {
  return <Outlet />
}

/**
 * One row of the manage list (design 12b): icon, label, chevron. Renders a
 * real `<Link>` or `<button>` so tab order, Enter and screen readers behave,
 * and the chevron is decorative — the row itself is the control.
 */
function ActionRow({
  icon: Icon,
  label,
  tone = 'ink',
  to,
  search,
  onClick,
}: {
  icon: typeof Pencil
  label: string
  tone?: 'ink' | 'danger'
  /** Renders the row as a link to this route instead of a button. */
  to?: string
  search?: Record<string, string>
  onClick?: () => void
}) {
  const className = cn(
    'tap flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left font-head text-body last:border-b-0',
    tone === 'danger' ? 'text-danger' : 'text-ink',
  )
  const inner = (
    <>
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
    </>
  )
  if (to) {
    /* The only link target is "change what I want" (new request for the same
       trip), so the href is built here rather than passed as a node. */
    return (
      <Link to={to} search={search} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}
export function ManageRequestScreen() {
  const { id } = Route.useParams()
  const { t, type, lang } = useI18n()
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
  /* Only offers still awaiting a reply belong in the waiting list: a declined
     or cross-request-superseded offer is no longer "Sent" — and it keeps the
     loser of a lock (design 20a) from seeing their dead offer as live. */
  const waitingOffers = offers.filter((offer) => offer.status === 'sent')
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
          : t('manage.status', { status: requestStatusLabel(lang, request.status) })

  const togglePause = (next: boolean) => {
    setPaused(next)
    setRequestPaused(request.id, next)
    if (next) toast.show(t('manage.pausedNote'))
  }

  /* Design 12b: the summary card says what you asked for and where, so the
     action list below is all "change / pause / withdraw" and nothing repeats
     the state. `request.choices[0]` is the 1st choice (docs/04 A step 6). */
  const wanted = request.choices[0] ? type(request.choices[0]) : null
  const where = trip ? (trip.passengers[0]?.coach ?? trip.train_no) : null

  return (
    <div>
      <h1 className="text-title text-ink">{t('manage.title')}</h1>

      {wanted ? (
        <Card className="mt-4 flex items-center gap-3">
          <TrainFront aria-hidden className="size-8 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <b className="block font-head text-body text-ink">
              {[
                t('manage.wanted', { berth: wanted }),
                where ? t('trip.coach', { coach: where }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </b>
            {searching ? (
              <Pill tone="accent" className="mt-1">
                {t('manage.waiting')}
              </Pill>
            ) : (
              <Pill tone={awaiting || locked ? 'primary' : 'neutral'} className="mt-1">
                {statusLabel}
              </Pill>
            )}
          </span>
        </Card>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <Pill tone={awaiting || locked ? 'primary' : 'neutral'}>{statusLabel}</Pill>
          {trip ? <span className="text-caption text-muted">{trip.train_no}</span> : null}
        </div>
      )}

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
          {/* Design 12c names the train: "Nobody has replied on 12752 yet". */}
          <CardTitle>
            {trip?.train_no
              ? t('manage.noReplyOn', { train: trip.train_no })
              : t('manage.noReplyTitle')}
          </CardTitle>
          <CardBody>{t('manage.noReplyBody')}</CardBody>
          <Button className="mt-3" asChild>
            <Link to="/share/$trainDate" params={{ trainDate: shareDate }}>
              <Share2 aria-hidden className="size-5" />
              {t('manage.share')}
            </Link>
          </Button>
          <Button className="mt-2" variant="outline" asChild>
            <Link to="/request/new" search={{ tripId: request.trip_id }}>
              {t('manage.tryAnother')}
            </Link>
          </Button>
        </Card>
      ) : null}

      {searching && waitingOffers.length > 0 ? (
        <section className="mt-4 space-y-2">
          {waitingOffers.map((offer) => (
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
                  {t(choiceRankKey(offer.matched_choice_rank))}
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
          {/* Design 12b: one card, three rows, each with an icon and a
              chevron — the request's whole life cycle, nothing else. */}
          <Card className="mt-4 flex-col items-stretch gap-0 p-0">
            <ActionRow
              icon={Pencil}
              label={t('manage.changeWhat')}
              to="/request/new"
              search={{ tripId: request.trip_id }}
            />
            <ActionRow
              icon={paused ? Play : Pause}
              label={paused ? t('manage.resume') : t('manage.pauseRequest')}
              onClick={() => togglePause(!paused)}
            />
            <ActionRow
              icon={Trash2}
              label={t('manage.withdrawRequest')}
              tone="danger"
              onClick={() => {
                withdrawRequest(request.id)
                toast.show(t('manage.withdrawn'))
                navigate({ to: '/' })
              }}
            />
          </Card>
          {paused ? (
            <p className="mt-2 text-caption text-muted">{t('manage.pausedNote')}</p>
          ) : null}
        </>
      ) : null}

      {/* Design 12b closes on the reassurance, not on a slogan: sending is
          free and money only moves after somebody says yes (rule 2). */}
      <p className="mt-4 flex items-start gap-2 rounded-card bg-wash p-3 text-caption text-ink">
        <Info aria-hidden className="size-4 shrink-0 text-primary" />
        {t('manage.payLater')}
      </p>
    </div>
  )
}