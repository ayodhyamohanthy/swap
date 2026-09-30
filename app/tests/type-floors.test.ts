/* docs/07 §Responsive sets two type floors for the passenger app:

     "body 16px minimum on `base`; never go below 14px for any text a passenger
      must read to make a decision (rule 4 credit, rule 6 no-swap promise,
      ₹ amounts)."

   Both were broken, and neither is visible to typecheck, the suite or the
   build: `--text-body` was 0.9375rem (15px), and the rule-4 / rule-6 / ₹ lines
   were rendered with `text-caption` (12px) on Home, the pay screens, the Swaps
   rules card and the trip screen — the smallest type in the theme carrying the
   copy that decides whether someone hands over ₹99.

   So this file checks the two things the section states, and it derives them
   rather than restating them: the pixel sizes come out of `styles.css`, and the
   copy that counts as "a decision" comes out of `locales/en.json`. A key whose
   English value names money, credit or the no-swap promise cannot be rendered
   below the floor, and if someone renames the token or moves the size, the
   guard follows instead of agreeing with itself.

   Admin screens are exempt on purpose: docs/07 floors what *a passenger* reads
   to decide something, and `/admin/*` is the operator's desktop console
   (designs 15-18, 23-24), which trades size for rows on screen. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'

const ROOT = join(import.meta.dirname, '..')
const CSS = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8')

/** A `--text-*` step in px, read from the theme block. rem only, because that
    is how every step in this file is declared. */
function stepPx(name: string): number {
  const match = CSS.match(new RegExp(`--text-${name}:\\s+([\\d.]+)rem`))
  expect(match, `--text-${name} is missing from styles.css (or not in rem)`).not.toBeNull()
  return Math.round(Number(match?.[1]) * 1600) / 100
}

const flat: Record<string, string> = {}
const flatten = (value: unknown, prefix = ''): void => {
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') flat[path] = child
    else flatten(child, path)
  }
}
flatten(en)

/** Copy a passenger decides on: a ₹ figure, the credit rules (rule 4), the
    no-swap promise (rule 6), or what a payment costs (rules 1-2). */
const DECISION = /₹|\bcredit\b|\bcash\b|\bfee\b|\bpay\b|\bpaid\b|12 months|No swap\?/i
const isDecision = (key: string): boolean =>
  !key.startsWith('admin.') && DECISION.test(flat[key] ?? '')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })

/**
 * Every `t('key')` that renders below the 14px floor, as `file:line  key`.
 *
 * The element a string belongs to is found by walking up to the nearest line
 * that opens a tag — JSX in this repo is one element per line or a two-line
 * `<span className=…>` + text, and the nearest opener is the element that
 * actually holds the text. A closing tag between the two means the caption
 * belongs to a *sibling*, so it is not reported: that distinction is what keeps
 * `<Pill>` (its own size, checked separately below) out of the list.
 */
function subFloorDecisionSites(): string[] {
  const floor = 14
  const sites: string[] = []
  for (const dir of ['routes', 'components', 'lib']) {
    for (const file of sourceFiles(join(ROOT, 'src', dir))) {
      if (/(^|\/)admin[.$]/.test(file)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const match of line.matchAll(/t\('([^']+)'/g)) {
          const key = match[1]
          if (!isDecision(key)) continue
          /* Not rendered text: an accessible name or a share payload. */
          const before = line.slice(0, match.index)
          if (/aria-label=|\blabel=|\btitle=/.test(before)) continue
          let owner = ''
          for (let j = i; j >= 0; j -= 1) {
            if (j !== i && /<\/[a-zA-Z]|\/>/.test(lines[j])) break
            const opener = lines[j].match(/className="([^"]*)"/)
            if (opener) {
              owner = opener[1]
              break
            }
          }
          const step = owner.match(/\btext-(title|section|body|note|caption)\b/)?.[1]
          if (step && stepPx(step) < floor) {
            sites.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${key}  (text-${step})`)
          }
        }
      })
    }
  }
  return sites
}

describe('docs/07 §Responsive type floors', () => {
  it('body text is at least 16px', () => {
    expect(stepPx('body')).toBeGreaterThanOrEqual(16)
  })

  it('the fine-print step exists and clears the 14px decision floor', () => {
    expect(stepPx('note')).toBeGreaterThanOrEqual(14)
  })

  it('the decorative step is below the floor, so the guard has something to catch', () => {
    expect(stepPx('caption')).toBeLessThan(14)
  })
})

describe('decision copy never renders below the floor', () => {
  it('no ₹ / credit / no-swap line sits at caption size on a passenger screen', () => {
    expect(subFloorDecisionSites()).toEqual([])
  })

  it('the money copy is present in the scan, so the pass above is not vacuous', () => {
    /* A guard that scans nothing passes forever. Assert the scan sees the
       decision keys it exists for, in the files this pass changed. */
    const keys = new Set(Object.keys(flat).filter(isDecision))
    for (const key of ['pay.under', 'home.creditNever', 'trip.noReward', 'groups.pay199']) {
      expect(keys, key).toContain(key)
    }
  })
})

describe('Pill carries money CTAs, so its own size is pinned', () => {
  const pill = readFileSync(join(ROOT, 'src', 'components', 'ui', 'pill.tsx'), 'utf8')

  it('renders at the note step, not the caption step', () => {
    expect(pill).toContain('text-note font-semibold')
    expect(pill).not.toContain('text-caption')
  })
})
