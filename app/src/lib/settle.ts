/* SeatSwap settlement — applies the money rules of docs/03 to a finished swap.
   `lib/outcomes` decides WHAT the outcome is (pure); this file is the only
   place that WRITES credit, so rules 3-6 are auditable in one screenful:

   - both say "swapped"        -> confirmed, acceptor earns ₹50 credit (rule 3)
   - both agree it didn't happen -> voided, requester's ₹99 becomes credit (rule 6)
   - answers differ             -> disputed, nothing moves until admin decides
   - any cancel after payment   -> voided, ₹99 to requester credit

   Credit is never cash and there is deliberately no path back to a bank here. */

import { credit, confirmationsFor, paymentFor, recordConfirmation, type ConfirmationRow } from './store'
import { cancelAfterPay, resolveConfirmations, type ConfirmOutcome, type Resolution } from './outcomes'
import { getRequest, settleRequest, type SwapRequest } from './requests'

export interface AnswerResult {
  /** null while the other side has not answered yet. */
  resolution: Resolution | null
  request?: SwapRequest
}

/** Record one side's "Did you swap?" answer and settle when both are in. */
export function answerSwap(
  requestId: string,
  side: ConfirmationRow['side'],
  outcome: ConfirmOutcome,
): AnswerResult {
  recordConfirmation(requestId, side, outcome)
  const both = confirmationsFor(requestId)
  const requester = both.find((row) => row.side === 'requester')
  const acceptor = both.find((row) => row.side === 'acceptor')
  if (!requester || !acceptor) return { resolution: null }
  return applyResolution(requestId, resolveConfirmations(requester.outcome, acceptor.outcome))
}

/** Apply a decided outcome: one status change plus the credit it entitles. */
export function applyResolution(requestId: string, resolution: Resolution): AnswerResult {
  const request = getRequest(requestId)
  if (!request) return { resolution: null }
  if (request.status !== 'locked' && request.status !== 'disputed') return { resolution: null }
  if (resolution.status === 'locked') return { resolution: null }
  /* Rule 6 refunds money that was actually collected. `locked` is reachable
     without a payment of its own — a group trip pays ₹199 once and covers up to
     three member swaps, and `lockCoveredRequest` locks them with no payment row
     — so a covered swap that then fails must NOT credit ₹99 that was never
     charged. That is not a rounding argument, it is ₹99 minted from nothing:
     permanently overstating the traveller's balance and understating revenue by
     the same amount, with a `credit_added` log row asserting it happened.

     Credit that is still owed for a covered swap comes from the ₹199 already
     paid, so the group trip is settled as voided (its members drop out of the
     covered count) and no phantom credit is issued.

     The acceptor's ₹50 is NOT filtered: rule 3 pays it for a swap that was
     accepted, and an acceptor who gave up a berth did so regardless of who
     paid for the transaction. Only the requester-side ₹99 is conditional on
     having been charged. */
  const paid = paymentFor(requestId)?.status === 'paid'
  const credits = paid ? resolution.credits : resolution.credits.filter((entry) => entry.to === 'acceptor')
  const updated = settleRequest(requestId, resolution.status)
  for (const entry of credits) {
    credit({
      to: entry.to,
      amountPaise: entry.amountPaise,
      kind: entry.kind,
      ref_request_id: requestId,
    })
  }
  return { resolution, request: updated ?? undefined }
}

/** Cancel after payment (either side, PNR cancelled, berth changed): ₹99 credit. */
export function voidSwap(requestId: string): AnswerResult {
  return applyResolution(requestId, cancelAfterPay())
}

/** Whose answers are still missing on this device. */
export function missingAnswers(requestId: string): ConfirmationRow['side'][] {
  const answered = confirmationsFor(requestId).map((row) => row.side)
  return (['requester', 'acceptor'] as const).filter((side) => !answered.includes(side))
}
