import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { getRequest } from '@/lib/requests'

/* Bare /swaps/$id landing (screens 29/30/47/48/49): every outcome state has a
   deep route, but shared links and notifications point here. It reads the
   request status and forwards to the right screen — never a dead end. */
export const Route = createFileRoute('/swaps/$id/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: SwapLandingScreen,
})
function SwapLandingScreen() {
  const { id } = Route.useParams() as { id: string }
  const { t } = useI18n()
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
  const target =
    request.status === 'locked' || request.status === 'confirmed' || request.status === 'disputed'
      ? { to: '/swaps/$id/summary' as const, label: t('summary.title') }
      : request.status === 'accepted_awaiting_payment'
        ? { to: '/pay/$requestId' as const, label: t('manage.payCta') }
        : { to: '/request/$id' as const, label: t('manage.title') }
  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{t('manage.status', { status: request.status })}</CardTitle>
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
