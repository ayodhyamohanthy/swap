import { createFileRoute } from '@tanstack/react-router'
import { GroupScreen } from './groups.$id'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 52 "Family trip" (design 19a). Lives at the index route so the
   /plan child screen can render under the /groups/$id layout. docs/05 gives it
   the Home tab, and designs 19a/19b both draw the three-tab bar — it is a
   normal in-app screen, not a setup screen (AGENTS.md 12). */
export const Route = createFileRoute('/groups/$id/')({
  staticData: { chrome: 'tabs', tab: 'home' } satisfies RouteChrome,
  component: GroupScreen,
})
