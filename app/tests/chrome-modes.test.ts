/* L1's chrome pass — the RouteChrome decisions docs/05's Tab column pins and
   no functional test sees:

   1. Four screens were `chrome: 'plain'` (back chevron, NO tab bar) while
      docs/05 marks all four Tab=Swaps and the mapped designs agree —
      2a (matches), 12b/12c (manage / no reply), 14a (rank choices) and
      14b (invite/share) each draw the bottom tab bar and NO back chevron.
      L3 filed this to L1 as a request for a new `sub` mode (back AND tabs);
      the designs say otherwise, so the fix is a mode flip, not new chrome.
      Design 2b also shows back+tabs but is not in docs/05's mapping (it is
      an unmapped twin of the invite screen) — if a future screen maps to it,
      `sub` becomes worth adding.
   2. Chat (docs/05 screen 36, Tab=Swaps) was `plain` too, and design 4b
      draws its identity in a green bar ABOVE the tab bar. The bar is a
      route-provided header (RouteChrome.header) so the live name and the
      rule-13-gated coach line can live in it; the gate is re-asserted here
      because moving the line out of the body must not move it out of
      revealedBerths().
   3. AppShell must prefer the route header over the wordmark TopBar — if
      that ternary ever flips, chat renders TWO bars (green + wordmark).

   Source-scanned on purpose: chrome is a staticData/JSX structure invariant,
   and these routes are not rendered anywhere but the browser. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'routes', file), 'utf8')

const FLIPPED = [
  'request.new.tsx',
  'request.$id.index.tsx',
  'request.$id.matches.tsx',
  'share.$trainDate.tsx',
] as const

describe('the four L3 screens carry the Swaps tab bar (docs/05, designs 2a/12b/14a/14b)', () => {
  it.each(FLIPPED)('%s declares chrome tabs + swaps', (file) => {
    const src = read(file)
    expect(src).toContain("staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome")
    expect(src).not.toContain("chrome: 'plain'")
  })

  it('all four were plain before — the flip is the whole change', () => {
    // Belt: if someone re-adds plain to any of them, the request regresses.
    for (const file of FLIPPED) expect(read(file)).not.toMatch(/chrome:\s*'plain'/)
  })
})

describe("chat chrome: design 4b's bar above the tab bar (docs/05 screen 36)", () => {
  const src = read('chat.$id.tsx')

  it('routes through RouteChrome.header with tabs + swaps', () => {
    expect(src).toContain(
      "staticData: { chrome: 'tabs', tab: 'swaps', header: ChatHeader } satisfies RouteChrome",
    )
    expect(src).not.toContain("chrome: 'plain'")
  })

  it("keeps rule 13's gate inside the bar", () => {
    const header = src.slice(src.indexOf('function ChatHeader'), src.indexOf('function ChatScreen'))
    expect(header).toContain('revealedBerths(id)')
    expect(header).toContain("t('trip.coach'")
    expect(header).toContain("t('trip.berth'")
    expect(header).toContain('bg-primary')
    expect(header).toContain("t('common.back')")
  })

  it('moves the identity out of the body — one title, in the bar', () => {
    expect(src).not.toContain("t('chat.title'")
  })
})

describe('AppShell: a route header replaces the wordmark bar, never stacks on it', () => {
  const shell = readFileSync(
    join(import.meta.dirname, '..', 'src', 'components', 'app-shell.tsx'),
    'utf8',
  )

  it('declares header as a component slot on RouteChrome', () => {
    expect(shell).toContain('header?: ComponentType')
  })

  it('renders chrome.header in place of TopBar', () => {
    const headerAt = shell.indexOf('<chrome.header />')
    const topBarAt = shell.indexOf('<TopBar')
    expect(headerAt).toBeGreaterThan(-1)
    expect(topBarAt).toBeGreaterThan(headerAt)
    // Same guarded branch: setup shows neither.
    expect(shell).toMatch(/mode !== 'setup' \? \(\s*chrome\.header \?/)
  })
})

/* Second chrome pass — rule 12 ("exactly 3 bottom tabs … setup screens show no
   tab bar") and docs/05's Tab column. 22 routes were `chrome: 'plain'`: back
   chevron, no tab bar, so they were dead ends — from "Arjun said yes · pay ₹99"
   there was no way to Home except the browser. docs/05 gives every one of them a
   tab, and the designs draw the bar: 3c/27a/27b/27c/28a/28c (pay), 4a/19c
   (incoming), 2c/4c/6b/6c/9c/13b/13c/20a/20b/20c/25b/25c/26a (swaps),
   21c/22a/29a/29b/10b (profile), 7c/8c/21a/21b (trip detail).

   Three screens draw the chevron *and* the bar (3c pay ₹99, 22b delete account,
   1c your berth), which is what RouteChrome.back exists for — L3 had asked for a
   fourth mode; the ink says a flag.

   `plain` survives on exactly three routes, each with the ink behind it:
   /trips/add (1b: chevron, no bar, no wordmark — a funnel step),
   /train/$number (docs/05 screen 65, the public web page, Tab "—"),
   /check (dev diagnostics, not in docs/05). */

const TABBED: ReadonlyArray<readonly [string, string]> = [
  ['pay.$requestId.index.tsx', "{ chrome: 'tabs', tab: 'swaps', back: true }"],
  ['pay.$requestId.method.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['pay.$requestId.upi.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['pay.$requestId.paypal.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['pay.$requestId.status.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['pay.$requestId.done.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['incoming.$id.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.index.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.cancel.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.confirm.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.done.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.meet.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.rate.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.share.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['swaps.$id.summary.tsx', "{ chrome: 'tabs', tab: 'swaps' }"],
  ['profile.settings.tsx', "{ chrome: 'tabs', tab: 'profile' }"],
  ['profile.help.tsx', "{ chrome: 'tabs', tab: 'profile' }"],
  ['profile.easy.tsx', "{ chrome: 'tabs', tab: 'profile' }"],
  ['profile.payments.index.tsx', "{ chrome: 'tabs', tab: 'profile' }"],
  ['profile.payments.$id.tsx', "{ chrome: 'tabs', tab: 'profile' }"],
  ['profile.delete.tsx', "{ chrome: 'tabs', tab: 'profile', back: true }"],
  ['trips.$tripId.tsx', "{ chrome: 'tabs', tab: 'home', back: true }"],
]

const BARLESS_OK = ['check.tsx', 'train.$number.tsx', 'trips.add.tsx']

describe('every non-setup screen carries the tab bar (rule 12, docs/05 Tab column)', () => {
  it.each(TABBED)('%s declares %s', (file, data) => {
    const src = read(file)
    expect(src).toContain(`staticData: ${data} satisfies RouteChrome`)
    expect(src).not.toContain("chrome: 'plain'")
  })

  it('leaves `plain` only on the three routes whose designs draw no bar', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'routes')
    const bare = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes("chrome: 'plain'"))
      .sort()
    expect(bare).toEqual(BARLESS_OK)
  })

  it('never highlights a tab on a screen that has no tab bar', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'routes')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const line = read(f).match(/staticData:\s*\{[^\n]*\}/)?.[0] ?? ''
      if (line.includes('tab:') || line.includes('back:')) {
        expect(line, `${f} sets tab/back without chrome: tabs`).toContain("chrome: 'tabs'")
      }
    }
  })
})

describe('RouteChrome.back: the chevron and the tabs are separate decisions', () => {
  const shell = readFileSync(
    join(import.meta.dirname, '..', 'src', 'components', 'app-shell.tsx'),
    'utf8',
  )

  it('declares back as an optional flag on RouteChrome', () => {
    expect(shell).toContain('back?: boolean')
  })

  it('shows the chevron on plain screens and wherever a route asks for it', () => {
    expect(shell).toContain("back={mode === 'plain' || chrome.back === true}")
  })
})
