import { createFileRoute } from '@tanstack/react-router'
import { NotFoundScreen } from '@/components/not-found'

/* Catch-all: an unknown URL is rendered as an ordinary route, the same way
   every real screen is, instead of through the router's not-found fallback. */
export const Route = createFileRoute('/$')({
  component: NotFoundScreen,
})
