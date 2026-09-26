/* Payment fixture bridge — prefers a REAL local request (lib/requests.ts) and
   falls back to one accepted demo request so the pay/summary/chat screens work
   before the Supabase peers exist. Group ids (`grp_…`) price at ₹199. */
import { acceptedOffer, getRequest } from './requests'

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
  const isGroup = id.startsWith('grp_')
  const request = getRequest(id)
  if (request) {
    const offer = acceptedOffer(id)
    return {
      id,
      acceptorName: offer?.acceptor_name ?? 'Arjun',
      status: STATUS_FALLBACK[request.status] ?? 'accepted_awaiting_payment',
      isGroup,
    }
  }
  return { id, acceptorName: 'Arjun', status: 'accepted_awaiting_payment', isGroup }
}
