import { createFileRoute } from '@tanstack/react-router'
import { SwapsScreen } from './swaps'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 56 "Swaps list" (design 5b). Lives at the index route so the
   /$id/* swap screens (summary / confirm / done) render under the /swaps
   layout instead of being swallowed by the list. */
export const Route = createFileRoute('/swaps/')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  component: SwapsScreen,
})
