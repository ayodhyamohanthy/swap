/* SeatSwap server payments — part 1: types + validators (docs/06).
   Secrets come from server env only, never returned to the browser. */
import { createServerFn } from '@tanstack/react-start'
import { buildQuote } from '@/lib/payments'
import { PRICE_PAISE } from '@/lib/money'

export type RequestStatus = 'draft' | 'searching' | 'accepted_awaiting_payment'
  | 'locked' | 'confirmed' | 'voided' | 'disputed' | 'expired' | 'withdrawn'
export interface SwapRequestRow { id: string; requester_id: string; status: RequestStatus }
export interface PaymentRow {
  id: string; request_id: string; payer_id: string
  provider: 'razorpay' | 'paypal' | 'credit'; provider_ref: string | null
  amount_paise: number; credit_used_paise: number; currency: 'INR'
  status: 'created' | 'pending' | 'paid' | 'failed'
}
export interface RazorpayOrder {
  order_id: string; amount_paise: number; currency: 'INR'
  receipt: string; key_id: string; credit_used_paise: number
}
export function serverEnv(name: string): string {
  const v = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.[name]
  if (!v) throw new Error(`missing_env:${name}`)
  return v
}
/** Caller must be requester + request awaiting payment (docs/06 Razorpay 1). */
export function assertCanPay(request: SwapRequestRow, callerId: string): void {
  if (request.requester_id !== callerId) throw new Error('not_requester')
  if (request.status !== 'accepted_awaiting_payment') throw new Error('not_awaiting_payment')
}
export function quoteFor(balancePaise: number, isGroup = false) {
  return buildQuote(balancePaise, isGroup)
}
export const createRazorpayOrder = createServerFn({ method: 'POST' })
  .validator((input: { requestId: string }) => input)
  .handler(async ({ data }): Promise<RazorpayOrder> => {
    const keyId = serverEnv('RAZORPAY_KEY_ID')
    serverEnv('RAZORPAY_KEY_SECRET')
    return {
      order_id: `order_${data.requestId}`, amount_paise: PRICE_PAISE,
      currency: 'INR', receipt: data.requestId, key_id: keyId, credit_used_paise: 0,
    }
  })
