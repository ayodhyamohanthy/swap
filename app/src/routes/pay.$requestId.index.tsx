import { createFileRoute } from '@tanstack/react-router'
import { PayScreen } from './pay.$requestId'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 21 "{name} said yes · pay ₹99" (design 3c). The pay screen lives in
   the parent file; this index route renders it under the /pay/$requestId
   layout so the child screens (method / status / done) can render. */
export const Route = createFileRoute('/pay/$requestId/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: PayScreen,
})
