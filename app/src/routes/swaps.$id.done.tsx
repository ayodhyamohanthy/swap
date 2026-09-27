import { Link, createFileRoute } from '@tanstack/react-router'
import { IndianRupee, ShieldCheck, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { demoRequest } from '@/lib/demo-swap'
import { acceptedOffer, offersFor, revealedBerths } from '@/lib/requests'

/* After-confirm states (docs/04 A14, designs 2c/20b/20c/25b/26a):
   swapped vs earned-50 vs added-to-credit vs answers-don't-match vs
   partner-cancelled. Credit is never cash and never goes back to the bank. */
export const Route = createFileRoute('/swaps/$id/done')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    state: s.state === 'earned' ? ('earned' as const)
      : s.state === 'credit' ? ('credit' as const)
      : s.state === 'review' ? ('review' as const)
      : s.state === 'partner' ? ('partner' as const)
      : ('swapped' as const),
  }),
  component: SwapDoneScreen,
})
function SwapDoneScreen() {
  const { id } = Route.useParams()
  const { state } = Route.useSearch()
  const { t } = useI18n()
  const req = demoRequest(id)
  const name = req.acceptorName
  /* Paid-swap metric, once per swap (StrictMode-safe via session flag). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = `seatswap.paid-done.${id}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      /* private mode */
    }
    trackEvent('payment_paid', { state })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (state === 'credit') return <CreditState />
  if (state === 'review') return <ReviewState name={name} />
  if (state === 'partner') return <PartnerState id={id} name={name} />
  if (state === 'earned') {
    return (
      <div>
        <Card className="mt-4">
          <CardTitle>{t('confirm.earned50', { name })}</CardTitle>
          <CardBody>{t('confirm.waiting', { name })}</CardBody>
        </Card>
        <Button className="mt-4" asChild>
          <Link to="/swaps/$id/rate" params={{ id }}>
            {t('rating.title')}
          </Link>
        </Button>
        <Button className="mt-2" variant="outline" asChild>
          <Link to="/swaps/$id/share" params={{ id }}>
            {t('confirm.share')}
          </Link>
        </Button>
        <Button className="mt-2" variant="ghost" asChild>
          <Link to="/">{t('confirm.addTrip')}</Link>
        </Button>
        <AppFooter />
      </div>
    )
  }
  return <SwappedState id={id} name={name} />
}

/* Design 02c: the new berth card, summary + family-share actions, and the
   acceptor's earned ₹50 line (rule 3 — credit lands only on confirmed done). */
function SwappedState({ id, name }: { id: string; name: string }) {
  const { t, type } = useI18n()
  const berths = revealedBerths(id)
  const offer = acceptedOffer(id)
  return (
    <div>
      <h1 className="mt-2 text-center text-title text-ink">{t('confirm.swapped')}</h1>
      <Card className="mt-4">
        <CardBody className="text-muted">{t('confirmExtra.newBerth')}</CardBody>
        <p className="font-head text-title font-bold text-ink">
          {berths?.theirs ?? t('matches.berthMasked')}
        </p>
        {offer ? (
          <CardBody>{type(offer.acceptor_berth_type)}</CardBody>
        ) : null}
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/swaps/$id/summary" params={{ id }}>
          {t('confirmExtra.viewSummary')}
        </Link>
      </Button>
      <Button className="mt-2" variant="outline" asChild>
        <Link to="/swaps/$id/share" params={{ id }}>
          {t('confirmExtra.shareFamily')}
        </Link>
      </Button>
      <Card className="mt-4 border-accent/40 bg-accent-soft">
        <CardBody className="font-semibold text-ink">{t('confirmExtra.earnedLine', { name })}</CardBody>
        <CardBody>{t('confirmExtra.kinder')}</CardBody>
      </Card>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/swaps/$id/rate" params={{ id }}>
          {t('rating.title')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}

/* Design 20b: big ₹99, ready-to-use line, 12-month never-cash line. */
function CreditState() {
  const { t } = useI18n()
  return (
    <div>
      <h1 className="mt-2 text-center text-title text-ink">{t('outcome.creditTitle')}</h1>
      <p className="mt-1 flex items-center justify-center gap-1 text-center font-head text-title font-bold text-primary">
        <IndianRupee aria-hidden className="size-7" />
        99
      </p>
      <Card className="mt-4">
        <CardBody className="font-semibold text-ink">{t('outcome.creditReady')}</CardBody>
        <CardBody>{t('confirm.creditAdded')}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/swaps">{t('outcome.seeRequests')}</Link>
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/">{t('confirm.addTrip')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}

/* Design 20c: the two answers side by side, the held-money line, a note box. */
function ReviewState({ name }: { name: string }) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <h1 className="mt-2 text-center text-title text-ink">{t('outcome.reviewTitle')}</h1>
      <p className="mt-1 text-center text-body text-muted">{t('outcome.reviewBody', { name })}</p>
      <Card className="mt-4 flex items-center gap-3">
        <ShieldCheck aria-hidden className="size-8 shrink-0 text-primary" />
        <CardBody className="text-ink">{t('dispute.body')}</CardBody>
      </Card>
      {saved ? (
        <Card className="mt-4 border-primary/30 bg-wash">
          <CardBody className="font-semibold text-ink">{t('outcome.noteSaved')}</CardBody>
        </Card>
      ) : (
        <>
          <Textarea
            className="mt-4"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('outcome.addNote')}
            aria-label={t('outcome.addNote')}
          />
          <Button className="mt-2" disabled={!note.trim()} onClick={() => setSaved(true)}>
            {t('outcome.addNote')}
          </Button>
        </>
      )}
      <Button className="mt-2" variant="outline" asChild>
        <Link to="/">{t('common.okay')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}

/* Design 25b: partner cancelled before meeting — credit plus other matches. */
function PartnerState({ id, name }: { id: string; name: string }) {
  const { t } = useI18n()
  const others = offersFor(id).length
  return (
    <div>
      <div className="mt-2 flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-wash text-muted">
          <UserX aria-hidden className="size-8" />
        </span>
      </div>
      <h1 className="mt-3 text-center text-title text-ink">{t('outcome.partnerTitle', { name })}</h1>
      <p className="mt-1 text-center text-body text-muted">{t('outcome.partnerBody', { name })}</p>
      <Card className="mt-4 border-primary/30 bg-wash">
        <CardBody className="font-semibold text-ink">{t('confirm.creditAdded')}</CardBody>
      </Card>
      {others > 0 ? (
        <p className="mt-4 text-body font-semibold text-ink">
          {t('outcome.otherMatches', { n: others })}
        </p>
      ) : null}
      <Button className="mt-3" asChild>
        <Link to="/request/$id/matches" params={{ id }}>
          {t('outcome.askFree')}
        </Link>
      </Button>
      <Button className="mt-2" variant="ghost" asChild>
        <Link to="/swaps">{t('dispute.back')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
