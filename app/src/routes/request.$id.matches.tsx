import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Share2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { matchesFor, sendCapped, sendRequest } from '@/lib/requests'
import { getTrip, isSeen } from '@/lib/store'
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
  const [selected, setSelected] = useState<string[]>([])
  const [sentOnce, setSentOnce] = useState(false)

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
    const chosen = selected.length > 0 ? selected : pending.map((row) => row.candidate.id)
    if (chosen.length === 0) return
    sendRequest(request.id, chosen)
    setSentOnce(true)
    setSelected([])
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
        {rows.map((row) => {
          if ('offer' in row) {
            const offer = row.offer
            const accepted = offer.status === 'accepted'
            return (
              <div
                key={offer.id}
                className="flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-wash font-head font-bold text-primary">
                  {offer.acceptor_name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-head text-body text-ink">{offer.acceptor_name}</b>
                  <small className="block text-caption text-muted">
                    {[t('matches.berthMasked'), offer.acceptor_coach ?? ''].filter(Boolean).join(' · ')}
                  </small>
                  <small className="block text-caption text-muted">
                    {t('matches.choice', { rank: offer.matched_choice_rank })}
                  </small>
                </span>
                <Pill tone={accepted ? 'primary' : 'neutral'}>
                  {accepted ? t('manage.acceptedCta') : t('matches.sentState')}
                </Pill>
              </div>
            )
          }
          const { candidate } = row
          const checked = selected.includes(candidate.id)
          return (
            <label
              key={candidate.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-card border border-line bg-card p-3 shadow-soft"
            >
              <input
                type="checkbox"
                className="size-6 accent-[var(--color-primary)]"
                checked={checked}
                onChange={() =>
                  setSelected((current) =>
                    checked
                      ? current.filter((value) => value !== candidate.id)
                      : [...current, candidate.id],
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <b className="block truncate font-head text-body text-ink">
                  {t('matches.berthMasked')} · {type(candidate.berth_type)}
                </b>
                <small className="block text-caption text-muted">
                  {[candidate.coach ?? '', candidate.class].filter(Boolean).join(' · ')}
                </small>
                <small className="mt-0.5 flex items-center gap-1 text-caption text-primary">
                  <ShieldCheck aria-hidden className="size-3.5" />
                  {t('matches.verified')}
                </small>
              </span>
            </label>
          )
        })}
      </section>

      {pending.length > 0 ? (
        <>
          <Button className="mt-4" onClick={send}>
            <Check aria-hidden className="size-5" />
            {t('matches.sendTo', { n: selected.length > 0 ? selected.length : pending.length })}
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