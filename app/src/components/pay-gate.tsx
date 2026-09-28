import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AppFooter } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { payAccess, type PayAccess } from '@/lib/pay-access'
import { acceptedOffer } from '@/lib/requests'
import { isGroupRequestId } from '@/lib/groups'

/* Rule 2 gate for the pay flow's child screens.
 *
 * `PayLayout` renders only an <Outlet/>, so `PayScreen`'s gate never ran for
 * `/method` or `/paypal` — a swap that was already paid, or not yet accepted,
 * still rendered a live "Pay ₹99" form. Money was never at risk (lib/checkout
 * refuses and the method screen redirects with the right copy) but the screen
 * was still lying about there being something to pay, which is the whole trust
 * problem rule 2 exists to prevent. L4 filed this on 2026-09-28.
 *
 * Only the two screens that *take* a payment are gated. `/status` and `/done`
 * are the journey after money has moved, so they must keep working once it has. */

export function PayGate({ requestId, children }: { requestId: string; children: ReactNode }) {
  const { t } = useI18n()
  const access: PayAccess = payAccess(requestId)

  if (access === 'payable') return <>{children}</>

  const isGroup = isGroupRequestId(requestId)
  const name = acceptedOffer(requestId)?.acceptor_name
  const title = isGroup ? t('pay.groupTitle') : t('pay.title', { name: name ?? '' })
  const body =
    access === 'covered'
      ? t('pay.coveredTitle')
      : access === 'paid'
        ? t('pay.alreadyPaid')
        : access === 'missing'
          ? t('home.empty')
          : t('pay.notYet')

  return (
    <div>
      <Card className="mt-4">
        <CardTitle>{title}</CardTitle>
        <CardBody>{body}</CardBody>
      </Card>
      <Button className="mt-4" asChild>
        <Link
          to={access === 'paid' || access === 'covered' ? '/swaps/$id' : '/request/$id'}
          params={{ id: requestId }}
        >
          {t('common.continue')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}
