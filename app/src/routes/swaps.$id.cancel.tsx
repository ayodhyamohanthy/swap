import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { acceptedOffer, getRequest } from '@/lib/requests'
import { voidSwap } from '@/lib/settle'
import { demoRequest } from '@/lib/demo-swap'

/* Screen 31 "Cancel this swap?" (design 25c): cancelling after payment moves
   the ₹99 to the requester's credit — never back to the bank (rule 6). */
export const Route = createFileRoute('/swaps/$id/cancel')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: CancelSwapScreen,
})
function CancelSwapScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const request = getRequest(id)
  const locked = request ? acceptedOffer(request.id) : undefined
  const name = locked?.acceptor_name ?? demoRequest(id).acceptorName
  return (
    <div>
      <div className="mt-2 flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-danger-soft text-danger">
          <CircleAlert aria-hidden className="size-8" />
        </span>
      </div>
      <h1 className="mt-3 text-center text-title text-ink">{t('cancelSwap.title')}</h1>
      <p className="mt-1 text-center text-body text-muted">{t('cancelSwap.body', { name })}</p>
      <Card className="mt-4 border-primary/30 bg-wash">
        <CardBody className="font-semibold text-ink">{t('cancelSwap.creditNote', { name })}</CardBody>
      </Card>
      <Button
        className="mt-4"
        variant="danger"
        onClick={() => {
          /* Either side cancelling after payment voids the swap and moves
             the ₹99 to the requester's credit — never back to a bank. */
          if (request?.status === 'locked') voidSwap(id)
          navigate({ to: '/swaps/$id/done', params: { id }, search: { state: 'credit' } })
        }}
      >
        {t('cancelSwap.confirm')}
      </Button>
      <Button className="mt-2" variant="neutral" asChild>
        <Link to="/swaps/$id/summary" params={{ id }}>
          {t('cancelSwap.keep')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
