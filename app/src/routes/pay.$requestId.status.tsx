import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'

/* Payment status (docs/04 A10, docs/09): pending vs failed copy. */
export const Route = createFileRoute('/pay/$requestId/status')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (s: Record<string, unknown>) => ({
    state: s.state === 'failed' ? ('failed' as const) : ('pending' as const),
  }),
  component: StatusScreen,
})
function StatusScreen() {
  const { requestId } = Route.useParams()
  const { state } = Route.useSearch()
  const { t } = useI18n()
  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{state === 'failed' ? t('pay.tryAgain') : t('pay.checkStatus')}</CardTitle>
        <CardBody>{state === 'failed' ? t('pay.failed') : t('pay.pending')}</CardBody>
        {state === 'failed' ? (
          <div className="mt-3 flex flex-col gap-2">
            <Button asChild><Link to="/pay/$requestId/method" params={{ requestId }}>{t('pay.tryAgain')}</Link></Button>
            <Button variant="outline" asChild>
              <Link to="/pay/$requestId/method" params={{ requestId }}>{t('pay.otherWay')}</Link>
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-caption text-muted">{t('pay.pending')}</p>
        )}
      </Card>
      <AppFooter />
    </div>
  )
}
