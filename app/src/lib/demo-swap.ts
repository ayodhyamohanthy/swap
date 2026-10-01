/* Payment fixture bridge — prefers a REAL local request (lib/requests.ts) and
   falls back to one accepted demo request so the pay/summary/chat screens work
   before the Supabase peers exist. Group ids (`grp_…`) price at ₹199.
   The fallback name is the plain-language word every traveller already reads
   on the pay screens (common.traveller) — never a made-up person's name, so
   no demo label can be mistaken for a real co-passenger (rule 13). */
import { acceptedOffer, getRequest } from './requests'
import { isGroupRequestId } from './group-id'

export const DEMO_FALLBACK_NAME_KEY = 'common.traveller' as const

export const DEMO_FALLBACK_NAME = 'Traveller' as const

export interface DemoRequest {
  id: string
  acceptorName: string
  status: 'accepted_awaiting_payment' | 'locked' | 'confirmed' | 'voided' | 'disputed'
  isGroup: boolean
}

const STATUS_FALLBACK: Record<string, DemoRequest['status']> = {
  draft: 'accepted_awaiting_payment',
  searching: 'accepted_awaiting_payment',
  accepted_awaiting_payment: 'accepted_awaiting_payment',
  locked: 'locked',
  confirmed: 'confirmed',
  voided: 'voided',
  disputed: 'disputed',
}

export function demoRequest(id: string): DemoRequest {
  const isGroup = isGroupRequestId(id)
  const request = getRequest(id)
  if (request) {
    const offer = acceptedOffer(id)
    return {
      id,
      acceptorName: offer?.acceptor_name ?? DEMO_FALLBACK_NAME,
      status: STATUS_FALLBACK[request.status] ?? 'accepted_awaiting_payment',
      isGroup,
    }
  }
  return { id, acceptorName: DEMO_FALLBACK_NAME, status: 'accepted_awaiting_payment', isGroup }
}
