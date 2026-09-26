import { createFileRoute } from '@tanstack/react-router'
import { ManageRequestScreen } from './request.$id'
import type { RouteChrome } from '@/components/app-shell'

/* Screens 15-17 "Your request / No reply / You're the first" (design 12b, 12c)
   + screen 22 "2nd choice match" (14c). Lives at the index route so the
   /matches child screen can render under the /request/$id layout. */
export const Route = createFileRoute('/request/$id/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ManageRequestScreen,
})
