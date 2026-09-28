/* Screen 47 guard (design 6b "Something went wrong", docs/05 row 47).
   Why this file: all ten of `outcome.problem*` shipped in en + hi and had
   **zero** render sites — a designed screen with copy but no code, invisible
   to every other test because nothing asserted the keys were reachable. The
   split of Did-you-swap (design 4c: "Yes, we swapped" / "Something went
   wrong") also moved three of docs/04 A13's four answers onto this screen, so
   the answer set could silently shrink without failing typecheck, build or
   the settlement tests — they exercise `answerSwap`, not the screens that
   call it.

   These three assertions pin the wiring itself: the copy is rendered, the
   entry button exists, and the four answers of docs/09's Did-you-swap row are
   all still reachable. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { CONFIRM_OPTIONS } from '@/lib/outcomes'

const SRC = join(import.meta.dirname, '..', 'src')
const LANDING = readFileSync(join(SRC, 'routes', 'swaps.$id.index.tsx'), 'utf8')
const CONFIRM = readFileSync(join(SRC, 'routes', 'swaps.$id.confirm.tsx'), 'utf8')

/** Every key design 6b draws, in the order the screen renders them. */
const DESIGN_6B_KEYS = [
  'outcome.problemTitle',
  'outcome.problemSub',
  'outcome.pNoShow',
  'outcome.pNotPossible',
  'outcome.pChanged',
  'outcome.pRailway',
  'outcome.problemNote',
  'outcome.pLogged',
  'outcome.okay',
] as const

describe('screen 47 (design 6b) is wired, not just translated', () => {
  it('ships every reason in both launch languages', () => {
    /* Languages move independently of code: a key can vanish from one catalog
       while the screen still renders it in the other. */
    for (const key of DESIGN_6B_KEYS) {
      const [group, leaf] = key.split('.') as [keyof typeof en, string]
      expect((en[group] as Record<string, string>)[leaf], `en.json ${key}`).toBeTypeOf('string')
      expect((hi[group] as Record<string, string>)[leaf], `hi.json ${key}`).toBeTypeOf('string')
    }
  })

  it('renders every design-6b key in a screen', () => {
    for (const key of DESIGN_6B_KEYS) {
      expect(LANDING, `${key} must be rendered by a route`).toContain(`'${key}'`)
    }
  })

  it('reaches the screen from Did-you-swap (design 4c second button)', () => {
    expect(CONFIRM).toContain('search={{ view: \'problem\' }}')
    expect(CONFIRM).toContain("'outcome.problemTitle'")
  })

  it('keeps all four Did-you-swap answers of docs/04 A13 reachable', () => {
    /* The redesign split the answers across two screens: 'swapped' stays on
       confirm, the three negatives moved to screen 47's reason rows. If a row
       is dropped or mistyped, this fails before any user hits a dead answer. */
    const reasons = [...LANDING.matchAll(/outcome:\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(CONFIRM).toContain("answerSwap(id, side, 'swapped')")
    const reachable = new Set([...reasons, 'swapped'])
    expect([...reachable].sort()).toEqual([...CONFIRM_OPTIONS].sort())
  })
})
