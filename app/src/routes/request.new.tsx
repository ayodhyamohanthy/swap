import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { berthTypesFor, type BerthType } from '@/lib/pnr'
import { createRequest, type ReasonKey } from '@/lib/requests'
import { useTrips } from '@/lib/use-store'

/* Screen 10 "Rank your choices" + 9 chair-car seat picker (design 14a, 8b).
   Draft only — sending happens here and is always free (rule 2). */

export interface RequestNewSearch {
  tripId?: string
}

export const Route = createFileRoute('/request/new')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (search: Record<string, unknown>): RequestNewSearch => ({
    tripId: typeof search.tripId === 'string' ? search.tripId : undefined,
  }),
  component: RequestNewScreen,
})

const REASON_KEYS = [
  'request.reasons.family',
  'request.reasons.elder',
  'request.reasons.medical',
  'request.reasons.group',
  'request.reasons.window',
  'request.reasons.none',
] as const

const RANK_LABELS = ['request.first', 'request.second', 'request.third'] as const

function RequestNewScreen() {
  const { t, type } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const search = Route.useSearch()
  const trips = useTrips()

  const swappable = trips.filter((row) => row.passengers[0]?.status === 'CNF')
  const [tripId, setTripId] = useState(search.tripId ?? swappable[0]?.id ?? '')
  const trip = trips.find((row) => row.id === tripId) ?? swappable[0]
  const passenger = trip?.passengers[0]

  const [choices, setChoices] = useState<(BerthType | undefined)[]>([undefined, undefined, undefined])
  const [sameCoach, setSameCoach] = useState(false)
  const [keepTogether, setKeepTogether] = useState(false)
  const [reason, setReason] = useState<ReasonKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  const berthOptions = useMemo(() => berthTypesFor(trip?.class ?? 'SL'), [trip?.class])

  if (!trip) {
    return (
      <div>
        <h1 className="text-title text-ink">{t('request.title')}</h1>
        <Card className="mt-4">
          <CardTitle>{t('home.empty')}</CardTitle>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/trips/add">{t('home.addPnr')}</Link>
        </Button>
      </div>
    )
  }

  const chair = berthOptions.includes('WINDOW')

  function pickChoice(rank: number, berth: BerthType) {
    setError(null)
    setChoices((current) => {
      const next = [...current]
      /* One berth per rank; a repeat moves it to this rank. */
      for (let i = 0; i < next.length; i += 1) if (next[i] === berth) next[i] = undefined
      next[rank] = berth
      return next
    })
  }

  function submit() {
    const ranked = choices.filter((choice): choice is BerthType => Boolean(choice))
    if (ranked.length === 0) {
      setError(t('request.needChoice'))
      return
    }
    try {
      const request = createRequest({
        trip_id: trip.id,
        choices: ranked,
        same_coach: sameCoach,
        keep_together: keepTogether,
        reason_key: reason,
      })
      toast.show(t('request.saved'))
      navigate({ to: '/request/$id/matches', params: { id: request.id } })
    } catch {
      setError(t('request.needChoice'))
    }
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('request.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('request.sub')}</p>

      {swappable.length > 1 ? (
        <ChipRow className="mt-3">
          {swappable.map((row) => (
            <Chip key={row.id} selected={row.id === trip.id} onClick={() => setTripId(row.id)}>
              {row.train_no}
            </Chip>
          ))}
        </ChipRow>
      ) : null}

      {choices.map((choice, rank) => (
        <Card key={RANK_LABELS[rank]} className="mt-3">
          <p className="font-head text-section text-ink">{t(RANK_LABELS[rank])}</p>
          <p className="mt-0.5 text-caption text-muted">
            {t('request.pickBerth', { rank: t(RANK_LABELS[rank]) })}
          </p>
          <ChipRow className="mt-2">
            {berthOptions.map((option) => (
              <Chip key={option} selected={choice === option} onClick={() => pickChoice(rank, option)}>
                {type(option)}
              </Chip>
            ))}
          </ChipRow>
        </Card>
      ))}

      {chair ? <p className="mt-2 text-caption text-muted">{t('request.chairNote')}</p> : null}

      <Card className="mt-3 flex items-center gap-3">
        <span className="flex-1">
          <b className="block font-head text-body text-ink">{t('request.sameCoach')}</b>
          <span className="block text-caption text-muted">
            {t('request.sameCoachBody', { coach: passenger?.coach ?? '—' })}
          </span>
        </span>
        <Switch checked={sameCoach} aria-label={t('request.sameCoach')} onCheckedChange={setSameCoach} />
      </Card>

      <Card className="mt-3 flex items-center gap-3">
        <span className="flex-1">
          <b className="block font-head text-body text-ink">{t('request.keepTogether')}</b>
          <span className="block text-caption text-muted">{t('request.keepTogetherBody')}</span>
        </span>
        <Switch
          checked={keepTogether}
          aria-label={t('request.keepTogether')}
          onCheckedChange={setKeepTogether}
        />
      </Card>

      <Card className="mt-3">
        <p className="font-head text-section text-ink">{t('request.reason')}</p>
        <ChipRow className="mt-2">
          {REASON_KEYS.map((key) => (
            <Chip
              key={key}
              selected={reason === key}
              onClick={() => setReason(reason === key ? null : key)}
            >
              {t(key)}
            </Chip>
          ))}
        </ChipRow>
      </Card>

      {error ? <p className="mt-3 text-body font-semibold text-danger">{error}</p> : null}

      <Button className="mt-5" onClick={submit}>
        <ArrowLeftRight aria-hidden className="size-5" />
        {t('request.submit')}
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-caption text-muted">
        <Check aria-hidden className="size-4" />
        {t('first.sendFree')}
      </p>
    </div>
  )
}