import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { demoRequest } from '@/lib/demo-swap'

/* Swap summary — offline-capable card (docs/04 A12) + footer. */
export const Route = createFileRoute('/swaps/$id/summary')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: SummaryScreen,
})
function SummaryScreen() {
  const { id } = Route.useParams()
  const { t, date } = useI18n()
  const req = demoRequest(id)
  return (
    <div>
      <h1 className="text-title text-ink">{t('summary.title')}</h1>
      <p className="mt-1 text-caption text-muted">{t('summary.offline')}</p>
      <Card className="mt-4">
        <CardTitle>{t('summary.train', { n: '12951', date: date('2026-11-12') })}</CardTitle>
        <CardBody>
          {t('summary.youGive', { berth: 'B3 · 27' })} · {t('summary.youGet', { berth: 'B3 · 41' })}
        </CardBody>
        <p className="mt-2 text-body text-ink">{t('summary.keep')}</p>
        <p className="mt-1 text-caption text-muted">{t('chat.title', { name: req.acceptorName })}</p>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/swaps/$id/confirm" params={{ id }}>{t('confirm.title')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
