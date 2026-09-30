/* bundle-budget.mjs — docs/17's "Initial JS ≤ 200KB gzipped" rule, as pure
 * functions.
 *
 * WHY THIS EXISTS. docs/17 §"Performance budget (CI-enforceable)" states the
 * budget and calls it CI-enforceable, and until now nothing enforced it.
 * `verify-dist.mjs` §5 measures the TOTAL size of dist/client/assets and caps
 * the shell HTML at 40 KB, but the total of every route chunk is not the number
 * the contract names: the contract is about what the phone must download before
 * the first screen paints. Those are different numbers, and only one of them is
 * a budget. Measured on 0078bcf: initial JS was 188.6 KB gz against the 200 KB
 * budget — passing, but with 5.7% headroom, which is one dependency away from a
 * breach nobody would have seen.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. Same reason as
 * `lane-board.mjs` and `vendor-whitelist.mjs`: `verify-dist.mjs` imports
 * `node:fs`, and docs/11 records what a static `node:*` import cost under the
 * jsdom pool when `translator-lib.mjs` did it. A test cannot import the CLI, so
 * anything worth testing lives where a test can reach it. This module is
 * strings in, decisions out.
 */

/** docs/17: "Initial JS ≤ 200KB gzipped". */
export const BUDGET_BYTES = 200 * 1024

/**
 * The scripts a browser must fetch before the first screen can paint, taken
 * from the built `index.html`: every `rel="modulepreload"` hint and every
 * `<script type="module">`. Deduplicated and in document order.
 *
 * Deliberately NOT the whole of `assets/`: route chunks are code-split and load
 * on navigation, so counting them would measure the app rather than the entry,
 * and would make the budget fail for a reason the contract does not describe.
 *
 * @returns {string[]}
 */
export function initialScripts(htmlText) {
  const html = String(htmlText ?? '')
  const found = []
  const add = (href) => {
    if (href && !found.includes(href)) found.push(href)
  }
  for (const m of html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*>/g)) {
    add((m[0].match(/href=["']([^"']+)["']/) ?? [])[1])
  }
  for (const m of html.matchAll(/<script[^>]+type=["']module["'][^>]*>/g)) {
    add((m[0].match(/src=["']([^"']+)["']/) ?? [])[1])
  }
  return found
}

/**
 * Stylesheets from `index.html`. Not part of the JS budget — reported alongside
 * it because a first paint waits on both and the number is otherwise invisible.
 *
 * @returns {string[]}
 */
export function initialStylesheets(htmlText) {
  const out = []
  for (const m of String(htmlText ?? '').matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)) {
    const href = (m[0].match(/href=["']([^"']+)["']/) ?? [])[1]
    if (href && !out.includes(href)) out.push(href)
  }
  return out
}

/**
 * The verdict, with the numbers that produced it.
 *
 * Returns the headroom as well as the total because a green with 5% headroom
 * and a green with 80% headroom are different facts, and a bare "ok" cannot
 * tell them apart.
 *
 * @returns {{ ok: boolean, totalBytes: number, budgetBytes: number, headroomBytes: number }}
 */
export function budgetVerdict(totalBytes, budgetBytes = BUDGET_BYTES) {
  const total = Number(totalBytes) || 0
  const budget = Number(budgetBytes) || BUDGET_BYTES
  return {
    ok: total <= budget,
    totalBytes: total,
    budgetBytes: budget,
    headroomBytes: budget - total,
  }
}
