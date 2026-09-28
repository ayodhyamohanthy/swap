import { Link, Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowLeft,
  Ban,
  ChevronRight,
  CircleX,
  IndianRupee,
  TrainFront,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { requestStatusLabel, useI18n, type MessageKey } from '@/lib/i18n'
import { type ConfirmOutcome } from '@/lib/outcomes'
import { answerSwap } from '@/lib/settle'
import { getRequest, offersFor, type RequestStatus, type SwapRequest } from '@/lib/requests'
import { listTrips } from '@/lib/store'

/* Bare /swaps/$id landing (screens 29/30/47/48/49): every outcome state has a
   deep route, but shared links and notifications point here. It reads the
   request status and forwards to the right screen — never a dead end.

   `?view=problem` renders screen 47 (design 6b, "Something went wrong"): the
   reason list behind the second button on Did-you-swap (design 4c). The four
   rows are the negative answers of docs/04 A13 plus the railway case — each
   records the side's own answer through answerSwap, so rule 6 still decides
   the money: voided only when both sides agree the swap didn't happen. */
export const Route = createFileRoute('/swaps/$id/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>): { view?: 'problem' } => ({
    view: s.view === 'problem' ? 'problem' : undefined,
  }),
  component: SwapLandingScreen,
})

/** Design 6b's four reason rows → the answer each one records. The last two
    map to the same outcome: a berth the railway changed is a swap that could
    not happen, not a change of mind. */
const REASONS: ReadonlyArray<{ key: MessageKey; outcome: ConfirmOutcome; icon: LucideIcon; tone: string }> = [
  { key: 'outcome.pNoShow', outcome: 'no_show', icon: Users, tone: 'bg-accent-soft text-accent' },
  { key: 'outcome.pNotPossible', outcome: 'not_possible', icon: Ban, tone: 'bg-danger-soft text-danger' },
  { key: 'outcome.pChanged', outcome: 'changed_mind', icon: CircleX, tone: 'bg-danger-soft text-danger' },
  { key: 'outcome.pRailway', outcome: 'not_possible', icon: TrainFront, tone: 'bg-wash text-primary' },
]

/** Where the bare landing sends each status (docs/05 screens 29/47/48/49).
    Kept as a pure table so the money rules can be tested without a router. */
export type LandingForward =
  | { kind: 'review' } // screen 49: answers don't match, money held (rule 7)
  | { kind: 'credit' } // screen 48: ₹99 added to the requester's credit (rule 6)
  | { kind: 'summary' }
  | { kind: 'pay' }
  | { kind: 'status' }

export function landingForward(status: RequestStatus, requesterSide: boolean): LandingForward {
  if (status === 'disputed') return { kind: 'review' }
  /* `voided` is only ever written by a resolution that also wrote the ₹99 to
     the requester, so only that side is told the money landed. The acceptor
     never pays — showing them "Added to your credit" would invent money. */
  if (status === 'voided') return requesterSide ? { kind: 'credit' } : { kind: 'status' }
  if (status === 'locked' || status === 'confirmed') return { kind: 'summary' }
  if (status === 'accepted_awaiting_payment') return { kind: 'pay' }
  return { kind: 'status' }
}

function SwapLandingScreen() {
  const { id } = Route.useParams() as { id: string }
  const { view } = Route.useSearch()
  const { t, lang } = useI18n()
  const request = getRequest(id)
  if (!request) {
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/">{t('nav.home')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }
  /* Only a live (paid, locked) swap can take answers — anything else falls
     through to the status forwarder below, so a stale problem link on a
     settled swap still lands somewhere real. */
  if (view === 'problem' && request.status === 'locked') {
    return <ProblemScreen id={id} request={request} />
  }
  /* Screen 29 / design 20a: this request lost its acceptor to another
     request's payment (L3's cross-request supersede). The pair is exact —
     within-request superseding only ever happens to a request that itself
     locked, so a `searching` request carrying a superseded offer can only be
     the loser of a lock elsewhere. {name} is the design's "Rohan paid first",
     but no other-requester name exists in the data (rule 13 caps what could
     be shown; the profiles join is L7's request to L8), so the canonical
     placeholder `common.traveller` fills it rather than inventing a person. */
  if (request.status === 'searching' && offersFor(id).some((offer) => offer.status === 'superseded')) {
    return (
      <div>
        <h1 className="mt-2 text-center text-title text-ink">{t('outcome.fasterTitle')}</h1>
        <p className="mt-1 text-center text-body text-muted">
          {t('outcome.fasterBody', { name: t('common.traveller') })}
        </p>
        <Card className="mt-4">
          <CardBody className="font-semibold text-ink">{t('outcome.stillOpen')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps">{t('outcome.seeRequests')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }
  const requesterSide = listTrips().some((trip) => trip.id === request.trip_id)
  /* Screens 48/49 ARE this route (docs/05), so they are the landing itself —
     an automatic forward, not a button standing between the traveller and
     the answer to "what happened to my ₹99". */
  const forward = landingForward(request.status, requesterSide)
  if (forward.kind === 'review' || forward.kind === 'credit') {
    return (
      <Navigate
        to="/swaps/$id/done"
        params={{ id }}
        search={{ state: forward.kind === 'review' ? 'review' : 'credit' }}
      />
    )
  }
  const target =
    forward.kind === 'summary'
      ? { to: '/swaps/$id/summary' as const, label: t('summary.title') }
      : forward.kind === 'pay'
        ? { to: '/pay/$requestId' as const, label: t('manage.payCta') }
        : { to: '/request/$id' as const, label: t('manage.title') }
  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{t('manage.status', { status: requestStatusLabel(lang, request.status) })}</CardTitle>
        <CardBody>{t('updates.open')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        {target.to === '/pay/$requestId'
          ? <Link to={target.to} params={{ requestId: id }}>{target.label}</Link>
          : <Link to={target.to} params={{ id }}>{target.label}</Link>}
      </Button>
      <AppFooter />
    </div>
  )
}

/* Design 6b: back arrow, title, the four reason rows, then the rule-6 note.
   Rule 6 credits the *requester* — the side that paid — so the note is shown
   to them only; the acceptor never pays ₹99 and must not be told it lands in
   their credit. */
function ProblemScreen({ id, request }: { id: string; request: SwapRequest }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  /* Keyed to the request: the router keeps this component mounted when only
     the $id segment changes, so a bare boolean would show one swap's thanks
     screen on the next swap's reason list. */
  const [loggedFor, setLoggedFor] = useState<string | null>(null)
  const requesterSide = listTrips().some((trip) => trip.id === request.trip_id)

  function pick(reason: (typeof REASONS)[number]) {
    const side = requesterSide ? 'requester' : 'acceptor'
    const result = answerSwap(id, side, reason.outcome)
    const status = result.resolution?.status
    if (status === 'confirmed') {
      navigate({ to: '/swaps/$id/done', params: { id }, search: { state: side === 'acceptor' ? 'earned' : 'swapped' } })
    } else if (status === 'voided') {
      navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'credit' } })
    } else if (status === 'disputed') {
      navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'review' } })
    } else {
      /* One side answered; the other still has to, so the design's thanks
         line stands in until the settlement decides where the money goes. */
      setLoggedFor(id)
    }
  }

  if (loggedFor === id) {
    return (
      <div>
        <Card className="mt-4 border-primary/30 bg-wash">
          <CardBody className="font-semibold text-ink">{t('outcome.pLogged')}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id/summary" params={{ id }}>{t('outcome.okay')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }

  return (
    <div>
      <div className="-ml-2 flex items-center">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} asChild>
          <Link to="/swaps/$id/confirm" params={{ id }}>
            <ArrowLeft aria-hidden className="size-5" />
          </Link>
        </Button>
      </div>
      <h1 className="text-title text-ink">{t('outcome.problemTitle')}</h1>
      <p className="mt-1 text-body text-muted">{t('outcome.problemSub')}</p>
      <div className="mt-4 flex flex-col gap-2">
        {REASONS.map((reason) => {
          const Icon = reason.icon
          return (
            <button
              key={reason.key}
              type="button"
              onClick={() => pick(reason)}
              className="flex min-h-14 w-full items-center gap-3 rounded-card border border-line bg-card px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${reason.tone}`}>
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="flex-1 font-head text-body text-ink">{t(reason.key)}</span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
            </button>
          )
        })}
      </div>
      {requesterSide ? (
        <Card className="mt-4 border-primary/30 bg-wash">
          <CardBody className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-ink">
              <IndianRupee aria-hidden className="size-5" />
            </span>
            <span className="font-semibold text-ink">{t('outcome.problemNote')}</span>
          </CardBody>
        </Card>
      ) : null}
      <AppFooter />
    </div>
  )
}
