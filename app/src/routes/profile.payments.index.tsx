import { createFileRoute } from '@tanstack/react-router'
import { PaymentsScreen } from './profile.payments'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 58 "Payments & receipts" (design 29a). Lives at the index route so
   the /$id receipt screen can render under the /profile/payments layout. */
export const Route = createFileRoute('/profile/payments/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: PaymentsScreen,
})
