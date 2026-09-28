/* Rule 2: may this swap take money right now?
 *
 * One definition, read by every screen in the pay flow. It used to live inside
 * the `/pay/$requestId` index route, which is why it drifted: the child screens
 * render through the parent's <Outlet/>, so the index component never ran for
 * `/method` or `/paypal` and those screens could still draw a live "Pay ₹99"
 * over a swap that was already paid. L4 filed that on 2026-09-28.
 *
 * `covered` is deliberately its own state: a member swap already paid for by a
 * ₹199 group trip locks with no second charge, so no screen may offer one. */
import { payableStatus } from './checkout'
import { GROUP_MAX_SWAPS } from './money'
import { getGroup, isGroupRequestId } from './groups'
import { getRequest, groupLockedCount, type RequestStatus } from './requests'

export type PayAccess = 'payable' | 'covered' | 'paid' | 'not-yet' | 'missing'

/** Renames `payableStatus`'s states for the screens, plus 'missing'. */
export function payGate(status: RequestStatus | undefined): 'payable' | 'paid' | 'not-yet' | 'missing' {
  if (!status) return 'missing'
  const state = payableStatus(status)
  if (state === 'payable') return 'payable'
  return state === 'already_paid' ? 'paid' : 'not-yet'
}

export function payAccess(requestId: string): PayAccess {
  if (isGroupRequestId(requestId)) {
    const group = getGroup(requestId)
    if (!group) return 'missing'
    return group.paid ? 'paid' : 'payable'
  }
  const request = getRequest(requestId)
  const gate = payGate(request?.status)
  if (gate !== 'payable' || !request) return gate
  const covering = request.group_id ? getGroup(request.group_id) : undefined
  if (covering?.paid && groupLockedCount(covering.id) < GROUP_MAX_SWAPS) return 'covered'
  return 'payable'
}
