/* bundle-budget: docs/17's "Initial JS ≤ 200KB gzipped", made checkable.
 *
 * WHY THESE EXIST. docs/17 §"Performance budget (CI-enforceable)" names the
 * budget and calls it CI-enforceable, and nothing enforced it. `verify-dist.mjs`
 * §5 measured the total size of dist/client/assets — every route chunk
 * included — which is not the number the contract names and not the number the
 * phone waits on. The two differ by an order of magnitude, so "assets total
 * 1798 KB" could sit next to "initial JS is over budget" and neither number
 * would reveal the other.
 *
 * The load-bearing property is the LAST one: initial JS is measured from
 * `index.html`'s own modulepreload/script tags, so a chunk that is code-split
 * and loaded on navigation cannot be counted as if it blocked first paint, and
 * a chunk that IS on the critical path cannot hide.
 *
 * Imported from `scripts/bundle-budget.mjs`, which imports NOTHING:
 * `verify-dist.mjs` pulls in `node:fs` and `node:zlib`, and docs/11 records what
 * a static `node:*` import cost under the jsdom pool when `translator-lib.mjs`
 * did the same — it broke collection for six lanes.
 */
import { describe, expect, it } from 'vitest'

import {
  BUDGET_BYTES,
  budgetVerdict,
  initialScripts,
  initialStylesheets,
} from '../scripts/bundle-budget.mjs'

/* Shaped like the real dist/client/index.html: a modulepreload per critical
   chunk, the entry repeated as both a preload and the module script, plus the
   things that must NOT be counted. */
const HTML = [
  '<!DOCTYPE html><html><head>',
  '<link rel="stylesheet" href="/assets/styles-abc.css" data-precedence="default"/>',
  '<link rel="modulepreload" href="/assets/index-entry.js"/>',
  '<link rel="modulepreload" href="/assets/index-shared.js"/>',
  '<link rel="modulepreload" href="/assets/lock-icon.js"/>',
  '<link rel="manifest" href="/manifest.webmanifest"/>',
  '<link rel="icon" type="image/png" href="/icons/icon-192.png"/>',
  '<script>(function(){try{localStorage.getItem("seatswap.easy.v1")}catch(e){}})();</script>',
  '</head><body>',
  '<script data-tsr-stream-part="">self.$_TSR={};</script>',
  '<script type="module" async="" src="/assets/index-entry.js"></script>',
  '</body></html>',
].join('\n')

describe('initialScripts', () => {
  it('collects modulepreload hints and the module script', () => {
    expect(initialScripts(HTML)).toEqual([
      '/assets/index-entry.js',
      '/assets/index-shared.js',
      '/assets/lock-icon.js',
    ])
  })

  it('deduplicates the entry, which appears as both a preload and a script', () => {
    const scripts = initialScripts(HTML)
    expect(scripts.filter((s) => s === '/assets/index-entry.js')).toHaveLength(1)
  })

  it('ignores scripts that are not module scripts', () => {
    /* The inline easy-mode boot script and the streaming shim are in the shell
       but carry no src, so they must not be counted or reported as missing. */
    for (const s of initialScripts(HTML)) expect(s.startsWith('/assets/')).toBe(true)
    expect(initialScripts(HTML)).not.toContain('/manifest.webmanifest')
    expect(initialScripts(HTML)).not.toContain('/icons/icon-192.png')
  })

  it('returns nothing for a shell with no module scripts, so the caller can tell "blind" from "clean"', () => {
    expect(initialScripts('')).toEqual([])
    expect(initialScripts('<html><body><h1>no scripts</h1></body></html>')).toEqual([])
  })
})

describe('initialStylesheets', () => {
  it('finds the stylesheet, and does not mistake the manifest or icon for one', () => {
    expect(initialStylesheets(HTML)).toEqual(['/assets/styles-abc.css'])
  })

  it('returns nothing when there is no stylesheet', () => {
    expect(initialStylesheets('<html></html>')).toEqual([])
  })
})

describe('budgetVerdict', () => {
  it('passes under budget and reports the headroom', () => {
    const v = budgetVerdict(188.6 * 1024)
    expect(v.ok).toBe(true)
    expect(v.budgetBytes).toBe(BUDGET_BYTES)
    expect(v.headroomBytes).toBeGreaterThan(0)
  })

  it('passes exactly at the budget', () => {
    const v = budgetVerdict(BUDGET_BYTES)
    expect(v.ok).toBe(true)
    expect(v.headroomBytes).toBe(0)
  })

  it('fails one byte over, and the headroom goes negative', () => {
    const v = budgetVerdict(BUDGET_BYTES + 1)
    expect(v.ok).toBe(false)
    expect(v.headroomBytes).toBe(-1)
  })

  it('treats an unmeasurable total as zero rather than as NaN', () => {
    /* A NaN total would make `total <= budget` false and fail the build for a
       reason nobody can read; zero at least fails for the honest reason. */
    expect(budgetVerdict(Number.NaN).totalBytes).toBe(0)
    expect(budgetVerdict(undefined as unknown as number).ok).toBe(true)
  })

  it('accepts an explicit budget, so the number lives in one place', () => {
    expect(budgetVerdict(300, 400).ok).toBe(true)
    expect(budgetVerdict(300, 200).ok).toBe(false)
  })
})
