const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'
import { TEXT_SIZE_TOKENS, cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

/* The accessibility floor docs/16-BEST-PRACTICES §3 states in one line — "contrast ≥ 4.5:1 for
   text" — and docs/07's palette is what decides whether the app meets it. Before
   docs/17-PRODUCTION-PATH W6.1 put axe on the screens, nothing checked either, and both ways the
   theme failed were invisible in the JSX:

   (1) `--muted` was documented as "ink at 55%", which composites over the cream
   page to 3.4:1. The hand-darkened hex that shipped in its place measured 4.48:1
   — 0.02 short, on every secondary line in the app, on every screen.
   (2) tailwind-merge could not tell this theme's font-SIZE tokens from its text
   COLOUR tokens, so `text-primary-ink text-section` merged down to the size and
   every primary Button rendered `--color-ink` on `--color-primary`: 2.3:1.

   A test that hardcoded `#666f68` would pass the day someone changed the
   stylesheet, so the hexes are read out of `app/src/styles.css` here and the
   ratios are recomputed. That is also what makes a regression reddening rather
   than a note: 4.48 was a real number produced by a real token, and nothing
   looked at it. */

const CSS = readFileSync(join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8')

/** `--color-*` hex tokens from the `@theme` block. */
function themeColours(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[match[1]] = match[2].toLowerCase()
  }
  return out
}

/** `--text-*` scale names, i.e. the `text-<name>` utilities they generate.
 *  Tailwind v4 hangs each size's modifiers off the same prefix —
 *  `--text-title--line-height`, `--text-section--font-weight` — and those are not
 *  utilities, so a name containing `--` is a modifier on a size, not a size. */
function themeTextSizes(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.matchAll(/--text-([a-z0-9-]+):/g)) {
    if (!match[1].includes('--')) out.add(match[1])
  }
  return [...out].sort()
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** `--color-wash` is a translucency, so text on a washed card sits over a blend. */
function over(fg: string, bg: string, alpha: number): string {
  const mix = (a: number, b: number) => Math.round(alpha * a + (1 - alpha) * b)
  const parts = [1, 3, 5].map((i) => mix(parseInt(fg.slice(i, i + 2), 16), parseInt(bg.slice(i, i + 2), 16)))
  return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const COLOUR = themeColours(CSS)
const WASH_OVER_CARD = over(COLOUR['primary'], COLOUR['card'], 0.08)

/* Only pairs the theme actually paints text with, and each names where. A
   `--color-*` token that stops being a plain hex (an rgba, a rename) drops out of
   `COLOUR`, so the next test asserts the keys this table reads are present —
   otherwise a parse that quietly returns nothing reports a clean palette. */
const TEXT_PAIRS: Array<{ label: string; fg: string; bg: string }> = [
  { label: 'body text on the app background', fg: COLOUR['ink'], bg: COLOUR['background'] },
  { label: 'body text on a card', fg: COLOUR['ink'], bg: COLOUR['card'] },
  { label: 'secondary text on the app background', fg: COLOUR['muted'], bg: COLOUR['background'] },
  { label: 'secondary text on a card', fg: COLOUR['muted'], bg: COLOUR['card'] },
  { label: 'secondary text on an accent-soft card', fg: COLOUR['muted'], bg: COLOUR['accent-soft'] },
  { label: 'secondary text on a danger-soft card', fg: COLOUR['muted'], bg: COLOUR['danger-soft'] },
  { label: 'secondary text on a primary wash', fg: COLOUR['muted'], bg: WASH_OVER_CARD },
  { label: 'primary label on the primary fill', fg: COLOUR['primary-ink'], bg: COLOUR['primary'] },
  { label: 'primary label on the danger fill', fg: COLOUR['primary-ink'], bg: COLOUR['danger'] },
  { label: 'link / ghost text on a card', fg: COLOUR['primary'], bg: COLOUR['card'] },
]

describe('the shipped palette against the 4.5:1 text floor (docs/16-BEST-PRACTICES §3)', () => {
  it('reads the tokens it is about to judge', () => {
    for (const key of ['ink', 'muted', 'primary', 'primary-ink', 'danger', 'background', 'card', 'accent-soft', 'danger-soft']) {
      expect(COLOUR[key], `--color-${key} is missing or is no longer a #rrggbb hex`).toBeTypeOf('string')
    }
    for (const pair of TEXT_PAIRS) {
      expect(pair.fg, 'a token in the pair table is undefined').toMatch(/^#[0-9a-f]{6}$/)
      expect(pair.bg, 'a token in the pair table is undefined').toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('meets 4.5:1 on every text pair the theme paints', () => {
    const failing = TEXT_PAIRS.map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) })).filter((p) => p.ratio < 4.5)
    expect(
      failing.map((p) => `${p.label}: ${p.ratio.toFixed(2)} (${p.fg} on ${p.bg})`),
      'text colours below the documented floor',
    ).toEqual([])
  })

  it('catches a token drifting back under the floor — the 4.48 that shipped', () => {
    /* The measured value this whole file exists for. Pinned rather than merely
       excluded, because "4.48 is a fail" is the claim; if the token is ever
       lightened again the loop above is what reddens, and this proves that loop
       is not vacuous. */
    expect(contrast('#6b746d', COLOUR['background'])).toBeLessThan(4.5)
    expect(contrast(COLOUR['muted'], COLOUR['background'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(COLOUR['ink'], COLOUR['primary'])).toBeLessThan(4.5)
  })
})

describe('the type scale survives cn()', () => {
  it('registers every --text-* token in the stylesheet', () => {
    const declared = themeTextSizes(CSS)
    expect(declared.length, 'no --text-* tokens parsed — the stylesheet format changed').toBeGreaterThan(0)
    expect([...TEXT_SIZE_TOKENS].sort()).toEqual(declared)
  })

  it('keeps both the colour and the size each Button variant declares', () => {
    const cases = [
      { variant: 'primary', size: 'default', keeps: ['bg-primary', 'text-primary-ink', 'text-section'] },
      { variant: 'outline', size: 'default', keeps: ['bg-card', 'text-primary', 'text-section'] },
      { variant: 'neutral', size: 'sm', keeps: ['bg-card', 'text-ink', 'text-body'] },
      { variant: 'danger', size: 'sm', keeps: ['bg-danger', 'text-primary-ink', 'text-body'] },
      { variant: 'ghost', size: 'sm', keeps: ['bg-transparent', 'text-primary', 'text-body'] },
    ] as const
    for (const c of cases) {
      const merged = cn(buttonVariants({ variant: c.variant, size: c.size }))
      for (const cls of c.keeps) {
        expect(merged, `${c.variant}/${c.size} lost "${cls}" in the merge: ${merged}`).toContain(cls)
      }
    }
  })

  it('still resolves a genuine colour conflict, so the fix is not "stop merging"', () => {
    expect(cn('text-primary-ink', 'text-ink')).toBe('text-ink')
    expect(cn('bg-card', 'bg-background')).toBe('bg-background')
    /* A size token does not touch the colour, and a colour token does not touch
       the size — that is the whole correction. */
    expect(cn('text-muted', 'text-caption')).toBe('text-muted text-caption')
  })
})
