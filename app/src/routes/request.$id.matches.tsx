import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Share2, ShieldCheck, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { matchesFor, sendCapped, sendRequest } from '@/lib/requests'
import { getTrip, isSeen, logActivity } from '@/lib/store'
import type { Trip } from '@/lib/store'
import type { CandidateSpec } from '@/lib/matching'
import { MAX_OUTGOING_PER_DAY } from '@/lib/matching'
import { useSwapRequest } from '@/lib/use-store'

/* Screen 11 "Matches · send free" (design 2a). Berths are always "Berth ••"
   here (rule 13); sign-in is asked on the FIRST send only (rule 8); sending
   never costs anything (rule 2). Zero matches => "You're the first" + share. */

export const Route = createFileRoute('/request/$id/matches')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: MatchesScreen,
})

function MatchesScreen() {
  const { id } = Route.useParams()
  const { t, type } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const request = useSwapRequest(id)
  /* Design 2a: every match starts ticked and the button reads "Send to 5 ·
     free" — the send is free (rule 2) and asking all of them costs nothing. So
     the state is who is TICKED OFF, not who is ticked on, and an empty list
     means "send to everyone". */
  const [deselected, setDeselected] = useState<string[]>([])
  const [sentOnce, setSentOnce] = useState(false)

  /* Success metric (docs/01 line 38, docs/12 line 78): the "you're the first on
     this train" rate. One row per request per session, using the same
     StrictMode-safe session flag the payment screens use.

     The count is taken inside the effect rather than read from the render
     below, because the `!request` early return sits above where `rows` and
     `capped` are derived, and a hook may not be called after it.

     `capped` is RECORDED here, not filtered. A user whose send budget is spent
     has not failed to find a match — the pool may be full of people — so
     counting them as "first on their train" is the same lie the card further
     down already guards against. The Overview excludes capped rows, which
     keeps the cap visible in the log instead of hiding it here. */
  useEffect(() => {
    if (!request || typeof window === 'undefined') return
    const key = `seatswap.matches-viewed.${id}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      /* private mode */
    }
    logActivity(
      'matches_viewed',
      { matches: matchesFor(id).length, capped: sendCapped() },
      { type: 'swap_request', id },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

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
  const rows = matchesFor(request.id)
  /* docs/03: 10 sends a day. When the budget is spent the pool comes back
     empty, so the "you're the first on this train" card would be a lie. */
  const capped = sendCapped()
  const pending = rows.filter(
    (row): row is { candidate: CandidateSpec; trip: Trip } => 'candidate' in row,
  )
  const offers = rows.filter((row) => 'offer' in row)

  const send = () => {
    if (!isSeen('signin_asked')) {
      /* Rule 8: Google sign-in is asked the first time a request goes out.
         "Not now" keeps the user here without sending. */
      navigate({
        to: '/signin',
        search: { redirect: `/request/${request.id}/matches` },
      })
      return
    }
    doSend()
  }

  const doSend = () => {
    const chosen = pending
      .map((row) => row.candidate.id)
      .filter((candidateId) => !deselected.includes(candidateId))
    if (chosen.length === 0) return
    sendRequest(request.id, chosen)
    setSentOnce(true)
    setDeselected([])
    toast.show(t('matches.sent'))
  }

  const trainLabel = trip?.train_no ?? ''
  const shareDate = `${trainLabel}-${trip?.journey_date ?? ''}`

  return (
    <div>
      <h1 className="text-title text-ink">{t('matches.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('matches.sub')}</p>

      {capped ? (
        <Card className="mt-4 border-accent/40 bg-accent-soft">
          <CardBody className="text-ink">
            {t('matches.cappedToday', { n: MAX_OUTGOING_PER_DAY })}
          </CardBody>
        </Card>
      ) : null}

      {rows.length === 0 && !capped ? (
        <Card className="mt-4 border-accent/40 bg-accent-soft">
          <CardTitle>{t('matches.firstTitle', { train: trainLabel })}</CardTitle>
          <p className="mt-1 text-body text-ink">{t('matches.firstBody')}</p>
          <Button className="mt-3" variant="outline" asChild>
            <Link to="/share/$trainDate" params={{ trainDate: shareDate }}>
              <Share2 aria-hidden className="size-5" />
              {t('matches.shareLink')}
            </Link>
          </Button>
        </Card>
      ) : null}

      <section className="mt-4 space-y-2">
        {rows.map((row, index) => {
          if ('offer' in row) {
            const offer = row.offer
            const accepted = offer.status === 'accepted'
            return (
              <div
                key={offer.id}
                className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
              >
                <span
                  aria-hidden
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full font-head font-bold ${
                    index % 2 === 0 ? 'bg-wash text-primary' : 'bg-accent-soft text-accent'
                  }`}
                >
                  {offer.acceptor_name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-head text-body text-ink">{offer.acceptor_name}</b>
                  <small className="block text-caption text-muted">
                    {[
                      type(offer.acceptor_berth_type),
                      offer.acceptor_coach
                        ? t('trip.coach', { coach: offer.acceptor_coach })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <small className="block text-caption text-muted">
                    {t('matches.berthMasked')} · {t('matches.choice', { rank: offer.matched_choice_rank })}
                  </small>
                </span>
                <Pill tone={accepted ? 'primary' : 'neutral'}>
                  {accepted ? t('manage.acceptedCta') : t('matches.sentState')}
                </Pill>
              </div>
            )
          }
          const { candidate } = row
          const checked = !deselected.includes(candidate.id)
          return (
            <label
              key={candidate.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              {/* Real checkbox, visually replaced by the design 2a check button:
                  the label still toggles it, so tap, keyboard and screen
                  readers all keep working. */}
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  setDeselected((current) =>
                    checked
                      ? [...current, candidate.id]
                      : current.filter((value) => value !== candidate.id),
                  )
                }
              />
              <span
                aria-hidden
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                  index % 2 === 0 ? 'bg-wash text-primary' : 'bg-accent-soft text-accent'
                }`}
              >
                {/* Rule 13: a match is a stranger until they accept, so the
                    row shows a person glyph, never an invented name. */}
                <User className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {t('matches.berthLine', { type: type(candidate.berth_type) })}
                </b>
                <small className="block text-caption text-muted">
                  {candidate.coach
                    ? t('trip.coach', { coach: candidate.coach })
                    : candidate.class}
                </small>
                <small className="mt-0.5 flex items-center gap-1 text-caption text-muted">
                  {t('matches.berthMasked')}
                  <ShieldCheck aria-hidden className="size-3.5 text-primary" />
                  {t('matches.verified')}
                </small>
              </span>
              <span
                aria-hidden
                className={`tap flex size-9 shrink-0 items-center justify-center rounded-lg border-2 ${
                  checked ? 'border-primary bg-primary text-white' : 'border-line bg-card text-transparent'
                }`}
              >
                <Check className="size-5" />
              </span>
            </label>
          )
        })}
      </section>

      {pending.length > 0 ? (
        <>
          <Button
            className="mt-4"
            onClick={send}
            disabled={pending.every((row) => deselected.includes(row.candidate.id))}
          >
            {t('matches.sendTo', {
              n: pending.filter((row) => !deselected.includes(row.candidate.id)).length,
            })}
          </Button>
          <p className="mt-2 text-caption text-muted">{t('matches.openSwaps')}</p>
        </>
      ) : null}

      {sentOnce || offers.length > 0 ? (
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/request/$id" params={{ id: request.id }}>{t('matches.viewRequest')}</Link>
        </Button>
      ) : null}

      <p className="mt-4 flex gap-2 text-caption text-muted">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {t('first.signedOutNote')}
      </p>
    </div>
  )
}