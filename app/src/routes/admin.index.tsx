import { createFileRoute } from '@tanstack/react-router'
import type { RouteChrome } from '@/components/app-shell'
import { Coins } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { buildOverview, type SwapDayPoint } from '@/lib/admin'
import { formatWeekday, useI18n, type LangCode } from '@/lib/i18n'
import { formatRupees } from '@/lib/money'
import { useAppState, useRequestsState } from '@/lib/use-store'

/* Admin A1 "Overview" (design 23). Today at a glance, straight from this
   device's activity_log until the backend is wired. Money stays in paise.

   Design 23's six tiles are PNRs added / Requests sent / Accepted / Swaps done /
   Money in / Credit given; "Payments today" and "Credit in circulation" are
   kept alongside them because a count and a rupee total answer different
   questions. */

export const Route = createFileRoute('/admin/')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminOverview,
})

/* Design 23's "Swaps this week". Hand-rolled SVG rather than a chart library:
   seven points do not justify a dependency, and a shape this small is easier
   to review as geometry than as library configuration.

   Days that have not happened yet are `null` and are simply not drawn, so the
   line stops at today instead of falling to the floor and implying that swaps
   collapsed. On a Monday that means a single dot, which is the honest picture
   of a week that has just started. */
function SwapWeekChart({ points, lang, title }: {
  points: SwapDayPoint[]
  lang: LangCode
  title: string
}) {
  const WIDTH = 340
  const HEIGHT = 150
  const LEFT = 30
  const RIGHT = 332
  const TOP = 12
  const BOTTOM = 112

  const values = points.map((point) => point.swaps).filter((value): value is number => value !== null)
  /* A floor of 1 keeps an all-zero week from dividing by zero. */
  const max = Math.max(1, ...values)
  const step = (RIGHT - LEFT) / Math.max(1, points.length - 1)
  const xAt = (index: number): number => LEFT + index * step
  const yAt = (value: number): number => BOTTOM - (value / max) * (BOTTOM - TOP)

  const drawn = points
    .map((point, index) => ({ point, index }))
    .filter((entry) => entry.point.swaps !== null)
    .map((entry) => ({ x: xAt(entry.index), y: yAt(entry.point.swaps as number) }))

  const line = drawn.map((point) => `${point.x},${point.y}`).join(' ')
  const area = drawn.length > 1
    ? `${drawn[0].x},${BOTTOM} ${line} ${drawn[drawn.length - 1].x},${BOTTOM}`
    : ''

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 w-full" role="img" aria-label={title}>
      {[0, 0.5, 1].map((fraction) => {
        const y = yAt(max * fraction)
        return (
          <g key={fraction}>
            <line x1={LEFT} x2={RIGHT} y1={y} y2={y} className="stroke-line" strokeWidth="1" />
            <text x={LEFT - 6} y={y + 3} textAnchor="end" className="fill-muted text-[9px]">
              {Math.round(max * fraction)}
            </text>
          </g>
        )
      })}

      {area ? <polygon points={area} className="fill-wash" /> : null}
      {drawn.length > 1 ? (
        <polyline
          points={line}
          fill="none"
          className="stroke-primary"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {drawn.map((point) => (
        <circle key={`${point.x}`} cx={point.x} cy={point.y} r="3" className="fill-primary" />
      ))}

      {points.map((point, index) => (
        <text
          key={point.day}
          x={xAt(index)}
          y={BOTTOM + 16}
          textAnchor="middle"
          className="fill-muted text-[9px]"
        >
          {formatWeekday(point.day, lang)}
        </text>
      ))}
    </svg>
  )
}

/* Design 23's "First on their train today" donut.
   Drawn as a dashed stroke on a circle rather than an arc path: the geometry is
   one line instead of a trigonometric one, and the round cap gives the design's
   softened ends for free.

   `percent === null` means nobody searched, which is NOT the same as 0% — 0%
   would assert that everyone who looked found someone. The ring renders empty
   and the card says so in words. */
function FirstOnTrainDonut({ percent, label }: { percent: number | null; label: string }) {
  const RADIUS = 40
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
  const filled = percent === null ? 0 : (percent / 100) * CIRCUMFERENCE

  return (
    <svg viewBox="0 0 120 120" className="mt-2 size-28" role="img" aria-label={label}>
      <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="12" className="stroke-line" />
      {percent === null ? null : (
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
          transform="rotate(-90 60 60)"
        />
      )}
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-ink font-head text-title font-bold"
      >
        {percent === null ? '—' : `${percent}%`}
      </text>
    </svg>
  )
}

function AdminOverview() {
  const { t, lang } = useI18n()
  const { activity, wallet, payments, trips } = useAppState()
  const { requests } = useRequestsState()
  const stats = buildOverview({
    activity,
    walletTotalPaise: wallet.reduce((n, row) => n + row.amount_paise, 0),
    payments,
    requests,
    trips,
  })

  const tiles: Array<[string, string | number]> = [
    [t('admin.s_pnrs'), stats.pnrsToday],
    [t('admin.s_requests'), stats.requestsToday],
    [t('admin.s_accepted'), stats.acceptedToday],
    [t('admin.s_paid'), stats.paidToday],
    [t('admin.s_swaps_done'), stats.swapsDoneToday],
    [t('admin.s_money_in'), formatRupees(stats.moneyInTodayPaise)],
    [t('admin.s_credit_given'), formatRupees(stats.creditGivenTodayPaise)],
    [t('admin.s_credit'), formatRupees(stats.creditInCirculationPaise)],
  ]

  return (
    <div>
      <h1 className="text-title text-ink">{t('admin.overview')}</h1>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <p className="text-caption text-muted">{label}</p>
            <p className="mt-1 font-head text-title font-bold text-primary">{value}</p>
          </Card>
        ))}
      </div>

      {/* A paid row whose credit portion is unknown is left out of Money in
          rather than counted as a full collection — say so instead of hiding it. */}
      {stats.moneyInUnknownToday > 0 ? (
        <p className="mt-2 text-caption text-muted">
          {stats.moneyInUnknownToday} {t('admin.moneyInUnknown')}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="font-head text-section text-ink">{t('admin.chartSwaps')}</p>
          <SwapWeekChart points={stats.swapsThisWeek} lang={lang} title={t('admin.chartSwaps')} />
        </Card>

        {stats.busiestTrains.length > 0 ? (
          <Card>
            <p className="font-head text-section text-ink">{t('admin.busiest')}</p>
            <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-caption text-muted">
              <span>{t('admin.colTrain')}</span>
              <span>{t('admin.colTrainName')}</span>
              <span>{t('admin.colSwapsDone')}</span>
            </div>
            <ul className="mt-1 space-y-1 text-body text-muted">
              {stats.busiestTrains.map((row) => (
                <li key={row.train_no} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <span>{row.train_no}</span>
                  <span className="truncate">{row.train_name}</span>
                  <span>{row.swaps}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {/* Design 23's "First on their train today". The rate is the share of
          today's match searches that came back empty (docs/01 line 38). */}
      <Card className="mt-4">
        <p className="font-head text-section text-ink">{t('admin.firstOnTrain')}</p>
        <FirstOnTrainDonut percent={stats.firstOnTrainToday.percent} label={t('admin.firstOnTrain')} />
        {stats.firstOnTrainToday.percent === null ? (
          <p className="mt-2 text-caption text-muted">{t('admin.firstOnTrainNone')}</p>
        ) : (
          <p className="mt-2 text-caption text-muted">
            {stats.firstOnTrainToday.first} / {stats.firstOnTrainToday.searched}
          </p>
        )}
        {stats.firstOnTrainToday.unknown > 0 ? (
          <p className="mt-2 text-caption text-muted">
            {stats.firstOnTrainToday.unknown} {t('admin.firstOnTrainUnknown')}
          </p>
        ) : null}
      </Card>

      <Card className="mt-4 flex items-start gap-2">
        <Coins aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        <CardBody>{t('admin.creditNever')}</CardBody>
      </Card>

      <p className="mt-3 text-caption text-muted">{t('admin.demoNote')}</p>
    </div>
  )
}
