import { createFileRoute } from '@tanstack/react-router'
import { GroupScreen } from './groups.$id'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 52 "Family trip" (design 19a). Lives at the index route so the
   /plan child screen can render under the /groups/$id layout. */
export const Route = createFileRoute('/groups/$id/')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: GroupScreen,
})
