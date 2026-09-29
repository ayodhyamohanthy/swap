import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftRight, Bell, Info, Plus, TrainFront } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { Switch } from '@/components/ui/switch'
import { localeFor, requestStatusLabel, useI18n, type LangCode } from '@/lib/i18n'
import { FEE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import { acceptedOffer, incomingFor, type IncomingRequest, type SwapRequest } from '@/lib/requests'
import { getTrip, setOpenToSwap, type Trip } from '@/lib/store'
import { useRequestsState, useTrips, useUnreadUpdates } from '@/lib/use-store'

/* Screen 56 "Swaps list" (design 5b) — the tab that holds everything a
   traveller comes back for: the requests I sent, the requests other people
   sent me, and the Updates bell. Requests and swaps used to be reachable only
   from the screen that created them, so a traveller who navigated away could
   never find their own ₹99 pay screen again.

   History is NOT here: a withdrawn or ended request has nothing left to do, and
   docs/04 gives it a home in Updates. `voided`/`disputed` do stay, because
   rule 6's credit lives behind them.

   /$id/* swap screens (summary / confirm / done) render under this layout, so
   the list itself lives at the index route (swaps.index.tsx). */

export const Route = createFileRoute('/swaps')({
  component: SwapsLayout,
})

/** Layout: the list renders at the index route; /$id/* swap screens render here. */
function SwapsLayout() {
  return <Outlet />
}

/** Where a row's tap goes. A union so every `<Link>` keeps its typed params. */
type Dest =
  | { to: '/request/$id'; params: { id: string } }
  | { to: '/pay/$requestId'; params: { requestId: string } }
  | { to: '/swaps/$id'; params: { id: string } }
  | { to: '/incoming/$id'; params: { id: string } }
  | { to: '/updates' }

/** Design 5b: the manage screen while it is still a search, the pay screen the
    moment money is owed (rule 2), the swap screens once it is locked. */
export function requestDest(request: SwapRequest): Dest {
  switch (request.status) {
    case 'accepted_awaiting_payment':
      return { to: '/pay/$requestId', params: { requestId: request.id } }
    case 'locked':
    case 'confirmed':
    case 'voided':
    case 'disputed':
      return { to: '/swaps/$id', params: { id: request.id } }
    default:
      return { to: '/request/$id', params: { id: request.id } }
  }
}

/** Ended and withdrawn requests are history, not actions (docs/04 gives them a
    row in Updates). Everything else still has a screen to open, newest first. */
export function liveRequests(requests: SwapRequest[]): SwapRequest[] {
  return requests
    .filter((row) => row.status !== 'withdrawn' && row.status !== 'expired')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/** Clock today, "Yesterday", then the date — design 5b's right-hand column. */
function stamp(iso: string, lang: LangCode, yesterday: string, formatDate: (iso: string) => string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const now = new Date()
  const dayNo = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const back = Math.round((dayNo(now) - dayNo(at)) / 86_400_000)
  if (back === 0) {
    try {
      return new Intl.DateTimeFormat(localeFor(lang), { hour: 'numeric', minute: '2-digit' }).format(at)
    } catch {
      return ''
    }
  }
  if (back === 1) return yesterday
  return formatDate(iso.slice(0, 10))
}

function Row({
  dest,
  name,
  status,
  note,
  when,
  trailing,
}: {
  dest: Dest
  name: string
  status: string
  note: string
  when: string
  trailing?: ReactNode
}) {
  const inner = (
    <>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-wash font-head text-body text-primary">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <b className="min-w-0 flex-1 truncate font-head text-body text-ink">{name}</b>
          {when ? <small className="shrink-0 text-caption text-muted">{when}</small> : null}
        </span>
        <span className="block truncate text-body text-ink">{status}</span>
        {note ? <small className="block truncate text-caption text-muted">{note}</small> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
    </>
  )
  const className =
    'tap mb-2 flex w-full items-start gap-3 rounded-card border border-line bg-card p-3 shadow-soft'
  /* One branch per destination: TanStack routes are typed, so the href cannot
     be assembled from a string at runtime. */
  switch (dest.to) {
    case '/request/$id':
      return (
        <Link to="/request/$id" params={dest.params} className={className}>
          {inner}
        </Link>
      )
    case '/pay/$requestId':
      return (
        <Link to="/pay/$requestId" params={dest.params} className={className}>
          {inner}
        </Link>
      )
    case '/swaps/$id':
      return (
        <Link to="/swaps/$id" params={dest.params} className={className}>
          {inner}
        </Link>
      )
    case '/incoming/$id':
      return (
        <Link to="/incoming/$id" params={dest.params} className={className}>
          {inner}
        </Link>
      )
    case '/updates':
      return (
        <Link to="/updates" className={className}>
          {inner}
        </Link>
      )
  }
}

/** The requester's own row: who holds the berth once someone said yes, the
    train while still searching (rule 13 — a stranger is a first name + initial
    until payment, and there is no name at all before a yes). */
function RequestRow({ request, trips }: { request: SwapRequest; trips: Trip[] }) {
  const { t, type, date, lang } = useI18n()
  const trip = trips.find((row) => row.id === request.trip_id) ?? getTrip(request.trip_id)
  const yes = acceptedOffer(request.id)
  const name = yes?.acceptor_name ?? (trip ? t('train.title', { n: trip.train_no }) : t('manage.title'))
  const status =
    request.status === 'searching'
      ? t('manage.waiting')
      : request.status === 'accepted_awaiting_payment'
        ? t('pay.title', { name: yes?.acceptor_name ?? '' })
        : request.status === 'confirmed'
          ? t('home.swapped')
          : requestStatusLabel(lang, request.status)
  const note = trip
    ? [
        date(trip.journey_date),
        request.choices[0] ? t('manage.wanted', { berth: type(request.choices[0]) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
      : ''

  return (
    <Row
      dest={requestDest(request)}
      name={name}
      status={status}
      note={note}
      when={stamp(request.updated_at, lang, t('swaps.yesterday'), date)}
      trailing={
        request.status === 'accepted_awaiting_payment' ? (
          <Pill tone="accent">{t('pay.payNow', { amount: PRICE_PAISE / 100 })}</Pill>
        ) : null
      }
    />
  )
}

/** The acceptor's row: a request waiting for my answer, the yes that is
    waiting for their payment, or the case that closed without me (20a). */
function IncomingRow({ incoming, trip }: { incoming: IncomingRequest; trip: Trip }) {
  const { t, type } = useI18n()
  const status =
    incoming.state === 'accepted'
      ? t('incoming.accepted')
      : incoming.state === 'faster'
        ? t('swaps.faster')
        : t('incoming.title')
  return (
    <Row
      dest={{ to: '/incoming/$id', params: { id: trip.id } }}
      name={incoming.requester_name}
      status={status}
      note={t('incoming.giveGet', { yours: type(incoming.give_berth), theirs: type(incoming.get_berth) })}
      /* The stand-in board row carries no arrival time, so none is shown —
         inventing one from the trip's creation date would claim a request
         arrived days before it did. */
      when=""
      trailing={incoming.state === 'none' ? <Pill tone="primary">{t('incoming.accept')}</Pill> : null}
    />
  )
}

export function SwapsScreen() {
  const { t, date } = useI18n()
  const trips = useTrips()
  const { requests } = useRequestsState()
  const unread = useUnreadUpdates()

  const mine = liveRequests(requests)
  const asked = trips.flatMap((trip) => {
    const incoming = incomingFor(trip.id)
    if (!incoming || incoming.state === 'declined' || incoming.state === 'backed_out') return []
    return [{ trip, incoming }]
  })
  const openTrips = trips.filter((trip) => trip.open_to_swap)
  /* "Ask for a swap" needs a confirmed ticket — a waitlisted one has no berth
     to offer yet (docs/04 A.2), so the CTA would only hit the guard on the
     next screen. */
  const canAsk = trips.some((trip) => trip.passengers[0]?.status === 'CNF')

  return (
    <div>
      <h1 className="text-title text-ink">{t('swaps.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('swaps.sub')}</p>

      {trips.length === 0 ? (
        <Card className="mt-4">
          <CardTitle>{t('swaps.empty')}</CardTitle>
          <Button className="mt-3" asChild>
            <Link to="/trips/add">{t('home.addPnr')}</Link>
          </Button>
        </Card>
      ) : null}

      {trips.length > 0 ? (
        <section className="mt-5">
          <div className="flex items-center gap-3">
            <CardTitle className="min-w-0 flex-1">{t('swaps.requests')}</CardTitle>
            {canAsk ? (
              <Button variant="ghost" size="sm" className="shrink-0 justify-end" asChild>
                <Link to="/request/new">
                  <Plus aria-hidden className="size-4" />
                  {t('swaps.ask')}
                </Link>
              </Button>
            ) : null}
          </div>
          {mine.length === 0 ? (
            <p className="mt-2 text-caption text-muted">{t('swaps.noRequests')}</p>
          ) : (
            <div className="mt-3">
              {mine.map((request) => (
                <RequestRow key={request.id} request={request} trips={trips} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {asked.length > 0 ? (
        <section className="mt-6">
          <CardTitle className="mb-2">{t('swaps.incoming')}</CardTitle>
          {asked.map(({ trip, incoming }) => (
            <IncomingRow key={trip.id} trip={trip} incoming={incoming} />
          ))}
        </section>
      ) : null}

      <section className="mt-6">
        <CardTitle className="mb-2">{t('swaps.updatesLink')}</CardTitle>
        <Row
          dest={{ to: '/updates' }}
          name={t('updates.title')}
          status={unread.length > 0 ? t('swaps.unread', { n: unread.length }) : t('updates.empty')}
          note=""
          when=""
          trailing={unread.length > 0 ? <Bell aria-hidden className="size-5 text-primary" /> : null}
        />
      </section>

      {trips.length > 0 ? (
        <section className="mt-6">
          <CardTitle className="mb-2">{t('swaps.openTitle')}</CardTitle>
          <CardBody className="mb-3">{t('swaps.openSub')}</CardBody>
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="mb-2 flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-wash text-primary">
                {trip.open_to_swap ? (
                  <ArrowLeftRight aria-hidden className="size-5" />
                ) : (
                  <TrainFront aria-hidden className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {trip.train_name || t('train.title', { n: trip.train_no })}
                </b>
                <small className="block text-caption text-muted">{date(trip.journey_date)}</small>
                <span className="mt-1 inline-flex">
                  <Pill tone={trip.open_to_swap ? 'primary' : 'neutral'}>
                    {trip.open_to_swap ? t('home.openToSwap') : t('home.notOpen')}
                  </Pill>
                </span>
              </span>
              <Switch
                checked={trip.open_to_swap}
                aria-label={t('trip.open')}
                onCheckedChange={(checked) => setOpenToSwap(trip.id, checked)}
              />
            </div>
          ))}
          {openTrips.length === 0 ? (
            <p className="mt-1 text-caption text-muted">{t('swaps.noneOpen')}</p>
          ) : null}
          <p className="mt-2 text-note text-muted">{t('trip.noReward')}</p>
        </section>
      ) : null}

      <section className="mt-6">
        <CardTitle className="mb-2">{t('swaps.rulesTitle')}</CardTitle>
        <Card>
          <dl className="text-body">
            <div className="flex items-center justify-between gap-3 py-1">
              <dt className="text-muted">{t('swaps.fee')}</dt>
              <dd className="font-head font-bold text-ink">₹{FEE_PAISE / 100}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1">
              <dt className="text-muted">{t('swaps.thankYou')}</dt>
              <dd className="font-head font-bold text-ink">₹{THANK_YOU_PAISE / 100}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-2">
              <dt className="font-head font-bold text-ink">{t('swaps.total')}</dt>
              <dd className="font-head text-title font-bold text-primary">₹{PRICE_PAISE / 100}</dd>
            </div>
          </dl>
          {/* Rule 1/2/4/6 copy — a passenger decides on it, so it is at the
              14px floor of docs/07 §Responsive, not at caption size. */}
          <ul className="mt-3 space-y-2 text-note text-muted">
            <li>{t('swaps.onlyAfter')}</li>
            <li>{t('swaps.noSwap')}</li>
            <li>{t('swaps.creditRule')}</li>
            <li>{t('swaps.acceptorFree')}</li>
          </ul>
        </Card>
      </section>

      <p className="mt-4 flex gap-2 text-caption text-muted">
        <Info aria-hidden className="size-4 shrink-0" />
        {t('profile.signInNote')}
      </p>

      <AppFooter />
    </div>
  )
}
