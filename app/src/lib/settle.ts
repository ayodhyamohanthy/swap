/* SeatSwap settlement — applies the money rules of docs/03 to a finished swap.
   `lib/outcomes` decides WHAT the outcome is (pure); this file is the only
   place that WRITES credit, so rules 3-6 are auditable in one screenful:

   - both say "swapped"        -> confirmed, acceptor earns ₹50 credit (rule 3)
   - both agree it didn't happen -> voided, requester's ₹99 becomes credit (rule 6)
   - answers differ             -> disputed, nothing moves until admin decides
   - any cancel after payment   -> voided, ₹99 to requester credit

   Credit is never cash and there is deliberately no path back to a bank here. */

import { credit, confirmationsFor, recordConfirmation, type ConfirmationRow } from './store'
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
  const updated = settleRequest(requestId, resolution.status)
  for (const entry of resolution.credits) {
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
