import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/* TanStack Start asks for a `getRouter` factory (see TanStack Start docs). */
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
