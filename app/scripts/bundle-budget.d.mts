/* Types for `scripts/bundle-budget.mjs`, so `tests/bundle-budget.test.ts` can
 * import it under `tsc`.
 *
 * Same reason as `lane-board.d.mts` and `vendor-whitelist.d.mts`: without this,
 * TS cannot read the `.mjs` and every call site is an implicit `any`. The
 * shapes are transcribed from the implementation and the tests are the real
 * check — a signature that drifted would fail there.
 */

/** docs/17: "Initial JS ≤ 200KB gzipped". */
export const BUDGET_BYTES: number

/** Scripts the browser must fetch before first paint, deduped, in order. */
export function initialScripts(htmlText: string): string[]

/** Stylesheets from index.html — reported with the budget, not part of it. */
export function initialStylesheets(htmlText: string): string[]

/** The verdict plus the numbers behind it, headroom included. */
export function budgetVerdict(
  totalBytes: number,
  budgetBytes?: number,
): {
  ok: boolean
  totalBytes: number
  budgetBytes: number
  headroomBytes: number
}
