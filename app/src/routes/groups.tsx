import { Outlet, createFileRoute } from '@tanstack/react-router'

/* Family trips (docs/04 C, designs 19a/19b): the list lives at /groups, one
   family at /groups/$id, its "seat everyone together" plan at /groups/$id/plan. */

export const Route = createFileRoute('/groups')({
  component: GroupsLayout,
})

/** Layout: /groups renders at the index route; /$id and /$id/plan render here. */
function GroupsLayout() {
  return <Outlet />
}
