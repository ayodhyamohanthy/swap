import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { SeedOptions } from './support'
import { journeyDate, offerRow, requestRow, seed, trip } from './support'

/* docs/17-PRODUCTION-PATH W6.1, second clause: "axe scan per screen with zero serious/critical
   violations". The suite already proves these screens RENDER and that nothing
   overflows at 360 — it does not prove they are operable by a screen reader or
   readable at the app's actual contrast, which is what axe-core checks.

   serious + critical, not all four impact levels, because that is the wording
   of the contract: moderate/minor findings are logged by the run but do not
   redden it. A rule the app cannot satisfy this quarter would have to be named
   and excluded WITH a reason, not filtered out wholesale — an `.exclude()` with
   no comment is how a scan starts passing for the wrong reason.

   WHY THE SCREENS ARE SEDED RATHER THAN BROWSED TO. Reaching a screen by
   clicking would make one screen's bug fail every later screen, and the report
   would name the wrong screen. Each entry seeds the store the way the flow's
   own spec does (`support.ts`), then deep-links — which is also the state a
   traveller arrives in from a push notification or a shared link.

   WHY A PASS COUNT IS ASSERTED, NOT JUST A VIOLATION COUNT. Zero violations is
   also what an axe run that reached nothing reports, so the suite would go green
   on a screen that never rendered. Measured with a throwaway probe on this file:
   `about:blank` reports 1 passing rule, and the app's real screens report 26–38
   (home 26, /trips/add 29, /admin 29–32, /profile 38). The floor sits between at
   5 — high enough to reject a scan that ran no rules, low enough not to redden on
   a screen that legitimately has fewer nodes. */

interface Screen {
  /** Names the test, so a failure points at a screen rather than a URL. */
  name: string
  path: string
  options?: SeedOptions
  /** A screen only renders its content once something is filled in. */
  fill?: { selector: string; value: string }[]
}

const withTripAndRequest = (): SeedOptions => ({
  trips: [
    trip({ id: 't_mine', pnr_last4: '9630' }),
    trip({
      id: 't_theirs',
      pnr_last4: '9648',
      open_to_swap: true,
      passengers: [
        { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
      ],
    }),
  ],
  requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'accepted_awaiting_payment' })],
  offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
})

const locked = (): SeedOptions => {
  const base = withTripAndRequest()
  return {
    ...base,
    requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'locked', locked_offer_id: 'off_1' })],
  }
}

const SCREENS: Screen[] = [
  /* Home's two branches are different documents (designs 1a vs 25a), so both
     are scanned: the empty state is the one that carries the PNR form. */
  { name: 'home · trips', path: '/', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'home · empty', path: '/', options: { trips: [] } },
  { name: 'add PNR', path: '/trips/add', options: {} },
  {
    name: 'add PNR · filled',
    path: '/trips/add',
    options: {},
    fill: [
      { selector: '#pnr', value: '4512789630' },
      { selector: '#train', value: '12951' },
      { selector: '#date', value: journeyDate() },
    ],
  },
  { name: 'trip detail', path: '/trips/t_mine', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'request · new', path: '/request/new', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'request · matches', path: '/request/req_1', options: withTripAndRequest() },
  { name: 'swaps list', path: '/swaps', options: withTripAndRequest() },
  { name: 'swap summary · paid', path: '/swaps/req_1/summary', options: locked() },
  { name: 'swap summary · unpaid', path: '/swaps/req_1/summary', options: withTripAndRequest() },
  { name: 'swap chat', path: '/chat/req_1', options: locked() },
  { name: 'pay · methods', path: '/pay/req_1', options: withTripAndRequest() },
  { name: 'pay · receipt', path: '/pay/req_1/done', options: locked() },
  { name: 'updates', path: '/updates', options: withTripAndRequest() },
  { name: 'on board', path: '/onboard/t_mine', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630', chart_prepared: true })] } },
  { name: 'groups', path: '/groups', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'share · coach link', path: `/share/12951-${journeyDate()}`, options: {} },
  { name: 'public train page', path: '/train/12951', options: {} },
  { name: 'profile', path: '/profile', options: withTripAndRequest() },
  { name: 'profile · settings', path: '/profile/settings', options: {} },
  { name: 'welcome · language', path: '/welcome/language', options: { fresh: true } },
  { name: 'admin · overview', path: '/admin', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'admin · activity', path: '/admin/activity', options: { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] } },
  { name: 'admin · swaps', path: '/admin/swaps', options: withTripAndRequest() },
]

/** Violations rendered so the report says what to fix, not just how many. */
function describe(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .map(
      (v) =>
        `  [${v.impact}] ${v.id} — ${v.help}\n` +
        v.nodes.map((n) => `      ${JSON.stringify(n.target)}  ${n.html.slice(0, 160)}`).join('\n'),
    )
    .join('\n')
}

for (const screen of SCREENS) {
  test(`${screen.name} has no serious or critical a11y violations`, async ({ page }) => {
    await seed(page, screen.options ?? {})
    await page.goto(screen.path)
    for (const field of screen.fill ?? []) await page.locator(field.selector).fill(field.value)

    const results = await new AxeBuilder({ page }).analyze()
    /* Evidence the scan actually ran against this document: a blank page yields
       1 passing rule, these screens yield 26–38. See the header for the probe. */
    expect(results.passes.length, `axe ran no rules on ${screen.name}`).toBeGreaterThan(5)
    /* Impact is filtered here rather than by the builder because
       @axe-core/playwright has no impact selector — `.withImpact()` does not
       exist, and a chain that silently returns `this` for an unknown method
       would filter nothing. So `v.impact` is read off each violation after the
       run, and the below-the-floor ones are printed: a finding that reddens
       nothing but is also named nowhere is how moderate issues become invisible. */
    const belowFloor = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')
    if (belowFloor.length > 0) {
      console.log(`${screen.name} — not reportable: ${belowFloor.map((v) => `${v.impact}/${v.id}`).join(', ')}`)
    }
    const reportable = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(reportable, `${screen.name} (${screen.path}) —\n${describe(reportable)}`).toEqual([])
  })
}
