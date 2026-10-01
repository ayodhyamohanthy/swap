/* Group-trip ids — one place, because three files had to answer "is this id a
   family trip or a swap request?" and two of them had copied the answer.

   WHY A MODULE OF ITS OWN. `lib/groups.ts` mints the id (`grp_…`) and stores it,
   and it imports `lib/store.ts` for the activity log — so `lib/store.ts` cannot
   import `groups.ts` back to ask the same question about a payment row it is
   normalising on load (`normalisePayment`). This file is the leaf both sides can
   reach: it imports nothing, so there is nothing to cycle into.

   It also removes the second hand-rolled `startsWith('grp_')`, which lived in
   `lib/demo-swap.ts`. A prefix that decides whether something is priced at ₹99
   or ₹199 has to be one constant, or the second copy is the one that silently
   diverges. */

/** Every local-first family-trip id starts with this. */
export const GROUP_ID_PREFIX = 'grp_'

/**
 * A group trip id rather than a swap request id.
 *
 * The prefix is load-bearing, not cosmetic: `/pay/:id` accepts both kinds of id
 * (docs/04 C — one ₹199 covers up to 3 swaps), so the same route argument is
 * priced and gated differently depending on this answer. Server-side group ids
 * are uuids, which is why code that has the row in hand must prefer the row's
 * own `group_id` column over this test — see `PaymentRow.group_id`.
 */
export function isGroupRequestId(id: string): boolean {
  return id.startsWith(GROUP_ID_PREFIX)
}