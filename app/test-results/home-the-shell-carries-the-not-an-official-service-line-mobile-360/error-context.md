# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> the shell carries the not-an-official-service line
- Location: e2e/home.spec.ts:44:1

# Error details

```
Error: hydration errors

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 0
Received:    1
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]: SeatSwap
        - generic [ref=e6]: A more comfortable journey together
      - link "Updates" [ref=e7] [cursor=pointer]:
        - /url: /updates
    - main [ref=e11]:
      - generic [ref=e12]:
        - heading "Where's your train taking you?" [level=1] [ref=e13]
        - paragraph [ref=e14]: Tell us what berth you want. We find people on your train who want to swap. You pay ₹99 only when someone says yes.
        - generic [ref=e15]:
          - generic [ref=e16]:
            - generic [ref=e17]: Enter 10-digit PNR
            - textbox "Enter 10-digit PNR" [ref=e18]
          - button "Find my berth" [ref=e19]
        - paragraph [ref=e20]:
          - link "Paste from IRCTC SMS" [ref=e21] [cursor=pointer]:
            - /url: /trips/add?paste=sms
        - paragraph [ref=e25]: No sign-in needed
        - link "Earn ₹50 credit every time you help someone swap" [ref=e29] [cursor=pointer]:
          - /url: /trips/add
        - generic [ref=e37]:
          - paragraph [ref=e38]: Keep your original ticket and ID with you.
          - paragraph [ref=e39]: SeatSwap is not an official railway service.
    - navigation "SeatSwap" [ref=e41]:
      - link "Home" [ref=e42] [cursor=pointer]:
        - /url: /
      - link "Swaps" [ref=e46] [cursor=pointer]:
        - /url: /swaps
      - link "Profile" [ref=e50] [cursor=pointer]:
        - /url: /profile
  - status
```

# Test source

```ts
  168 |     ...overrides,
  169 |   }
  170 | }
  171 | 
  172 | export function offerRow(
  173 |   overrides: Partial<OfferSeed> & { id: string; request_id: string; acceptor_trip_id: string },
  174 | ): OfferSeed {
  175 |   const stamp = new Date(Date.now() - 1_800_000).toISOString()
  176 |   return {
  177 |     acceptor_name: 'Traveller',
  178 |     acceptor_berth_type: 'UB',
  179 |     acceptor_coach: 'B6',
  180 |     acceptor_berth_no: '41',
  181 |     matched_choice_rank: 1,
  182 |     status: 'accepted',
  183 |     created_at: stamp,
  184 |     responded_at: stamp,
  185 |     ...overrides,
  186 |   }
  187 | }
  188 | 
  189 | export interface SeedOptions {
  190 |   trips?: TripSeed[]
  191 |   requests?: RequestSeed[]
  192 |   offers?: OfferSeed[]
  193 |   /** Overrides for the `seatswap.seen.v1` flags — e.g. dropping
  194 |    *  `signin_asked` to assert the first-send sign-in hop (agents.md rule 8). */
  195 |   seen?: Partial<Record<string, boolean>>
  196 |   /** Skip the onboarding flags entirely (default is: everything seen). */
  197 |   fresh?: boolean
  198 | }
  199 | 
  200 | /**
  201 |  * Install the seeded state before any app script runs.
  202 |  * Must be awaited BEFORE the first `page.goto` of the test.
  203 |  */
  204 | export async function seed(page: Page, options: SeedOptions = {}): Promise<void> {
  205 |   const seen = options.fresh ? (options.seen ?? {}) : { ...SEEN_ALL, ...(options.seen ?? {}) }
  206 |   const payload = {
  207 |     seen,
  208 |     trips: options.trips ?? [],
  209 |     requests: options.requests ?? [],
  210 |     offers: options.offers ?? [],
  211 |   }
  212 |   await page.addInitScript((data) => {
  213 |     const write = (key: string, value: unknown) => window.localStorage.setItem(key, JSON.stringify(value))
  214 |     window.localStorage.setItem('seatswap.lang.v1', 'en')
  215 |     write('seatswap.seen.v1', data.seen)
  216 |     write('seatswap.trips.v1', data.trips)
  217 |     write('seatswap.requests.v1', {
  218 |       requests: data.requests,
  219 |       offers: data.offers,
  220 |       incoming: {},
  221 |     })
  222 |   }, payload)
  223 | }
  224 | 
  225 | /** Console + page errors, in order, prefixed so the source is obvious. */
  226 | export interface ErrorWatch {
  227 |   errors: string[]
  228 | }
  229 | 
  230 | export function watchPage(page: Page): ErrorWatch {
  231 |   const errors: string[] = []
  232 |   page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.split('\n')[0]}`))
  233 |   page.on('console', (message) => {
  234 |     if (message.type() === 'error') errors.push(`console: ${message.text().split('\n')[0]}`)
  235 |   })
  236 |   return { errors }
  237 | }
  238 | 
  239 | /* The documented case: only `/` is prerendered, and the prerendered
  240 |    `dist/client/index.html` has an EMPTY `<main>` (React's `<!--$-->`
  241 |    redirect/suspense markers are all the prerender emitted). So every deep link
  242 |    hydrates against markup that cannot match what the client renders, and React
  243 |    reports it — measured, not assumed: 0 errors on an unseeded `/` (the marker
  244 |    boundaries defer that subtree) and exactly 1 on every other route.
  245 | 
  246 |    THE CODE LIST IS COMPLETE ONLY BECAUSE IT WAS MEASURED. The first version
  247 |    carried 418/423/425 and reported `/welcome/language` — which really does
  248 |    hydrate against empty markup — as "console errors other than the documented
  249 |    failure", because React 19 reports that case as **#520 followed by #422**
  250 |    ("hydrating failed, switching the whole root to client rendering") instead of
  251 |    #418. A pattern matching nothing reports green, and a pattern missing half
  252 |    the codes reports red on the honest case: both ways round, the guard lies.
  253 |    418/419/421/422/423/425/428/520 are React's hydration and suspense codes. */
  254 | const HYDRATION = /hydrat|minified react error #(418|419|421|422|423|425|428|520)\b/i
  255 | 
  256 | /**
  257 |  * Fail on any console error that is not the documented deep-link hydration
  258 |  * failure, and fail if even THAT exceeds `budget`.
  259 |  *
  260 |  * `budget: 0` is for `/`, which is prerendered: the client renders what the
  261 |  * server wrote, so there is nothing to hydrate against and zero is the honest
  262 |  * expectation (docs/14 L1 row: "`/` 0 console errors, every deep link exactly 1").
  263 |  */
  264 | export function assertOnlyHydration(watch: ErrorWatch, budget: number): void {
  265 |   const hydration = watch.errors.filter((line) => HYDRATION.test(line))
  266 |   const other = watch.errors.filter((line) => !HYDRATION.test(line))
  267 |   expect(other, 'console/page errors other than the documented deep-link hydration failure').toEqual([])
> 268 |   expect(hydration.length, 'hydration errors').toBeLessThanOrEqual(budget)
      |                                                ^ Error: hydration errors
  269 | }
  270 | 
```