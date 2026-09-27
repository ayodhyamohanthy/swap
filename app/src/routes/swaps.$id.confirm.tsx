import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { CONFIRM_OPTIONS, type ConfirmOutcome } from '@/lib/outcomes'

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
  const [picked, setPicked] = useState<ConfirmOutcome | null>(null)
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
      <Button className="mt-4" disabled={!picked} asChild={!!picked}>
        {picked
          ? (
            <Link
              to="/swaps/$id/done" params={{ id }}
              search={{ state: picked === 'swapped' ? 'swapped' : 'credit' }}
              onClick={() => trackEvent('confirmation', { outcome: picked })}
            >
              {t('confirm.submit')}
            </Link>
          )
          : <span aria-hidden>{t('confirm.submit')}</span>}
      </Button>
      <AppFooter />
    </div>
  )
}
