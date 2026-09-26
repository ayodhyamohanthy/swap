import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from './profile'
import type { RouteChrome } from '@/components/app-shell'

/* Screen 57 "Profile & credit" (design 5c). Lives at the index route so the
   child screens (settings / help / payments / easy / delete) render under
   the /profile layout instead of being swallowed by this screen. */
export const Route = createFileRoute('/profile/')({
  staticData: { chrome: 'tabs', tab: 'profile' } satisfies RouteChrome,
  component: ProfileScreen,
})
