import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { demoRequest } from '@/lib/demo-swap'

/* After-confirm states: swapped vs earned-50 vs credit-added (docs/04 A14). */
export const Route = createFileRoute('/swaps/$id/done')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    state: s.state === 'earned' ? ('earned' as const)
      : s.state === 'credit' ? ('credit' as const) : ('swapped' as const),
  }),
  component: SwapDoneScreen,
})
function SwapDoneScreen() {
  const { id } = Route.useParams()
  const { state } = Route.useSearch()
  const { t } = useI18n()
  const req = demoRequest(id)
  const title = state === 'earned' ? t('confirm.earned50', { name: req.acceptorName })
    : state === 'credit' ? t('confirm.creditAdded') : t('confirm.swapped')
  const body =
    state === 'credit'
      ? t('confirm.creditAdded')
      : state === 'earned'
        ? t('confirm.waiting', { name: req.acceptorName })
        : t('confirm.share')
  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{title}</CardTitle>
        <CardBody>{body}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link to="/">{t('confirm.addTrip')}</Link>
      </Button>
      <AppFooter />
    </div>
  )
}
