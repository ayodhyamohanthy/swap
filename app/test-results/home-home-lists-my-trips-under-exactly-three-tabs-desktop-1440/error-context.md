# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> home lists my trips under exactly three tabs
- Location: e2e/home.spec.ts:7:1

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
        - generic [ref=e13]:
          - heading "Your trips" [level=2] [ref=e14]
          - link "Train 12951 12951 · MMCT → NDLS Sun, 1 Nov You're the first here" [ref=e15] [cursor=pointer]:
            - /url: /trips/t_mine
            - generic [ref=e24]:
              - generic [ref=e25]: Train 12951
              - generic [ref=e26]: 12951 · MMCT → NDLS
              - generic [ref=e27]: Sun, 1 Nov
              - generic [ref=e28]: You're the first here
          - link "Train 12951 12951 · MMCT → NDLS Sun, 1 Nov Open to swap" [ref=e32] [cursor=pointer]:
            - /url: /trips/t_theirs
            - generic [ref=e41]:
              - generic [ref=e42]: Train 12951
              - generic [ref=e43]: 12951 · MMCT → NDLS
              - generic [ref=e44]: Sun, 1 Nov
              - generic [ref=e45]: Open to swap
        - generic [ref=e49]:
          - paragraph [ref=e50]: Keep your original ticket and ID with you.
          - paragraph [ref=e51]: SeatSwap is not an official railway service.
        - link "Add PNR" [ref=e52] [cursor=pointer]:
          - /url: /trips/add
    - navigation "SeatSwap" [ref=e57]:
      - link "Home" [ref=e58] [cursor=pointer]:
        - /url: /
      - link "Swaps" [ref=e62] [cursor=pointer]:
        - /url: /swaps
      - link "Profile" [ref=e66] [cursor=pointer]:
        - /url: /profile
  - status
```

# Test source

```ts
  156 |     requester_id: null,
  157 |     group_id: null,
  158 |     choices: ['UB'],
  159 |     same_coach: false,
  160 |     keep_together: false,
  161 |     reason_key: null,
  162 |     status: 'accepted_awaiting_payment',
  163 |     paused: false,
  164 |     locked_offer_id: null,
  165 |     sent_at: stamp,
  166 |     created_at: stamp,
  167 |     updated_at: stamp,
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
  239 | /* The documented deep-link case: React reports a minified hydration error in a
  240 |    production build. 418/423/425 are React's hydration codes; the literal
  241 |    "hydrat" covers dev builds and the attribute-mismatch wording. */
  242 | const HYDRATION = /hydrat|minified react error #(418|423|425)/i
  243 | 
  244 | /**
  245 |  * Fail on any console error that is not the documented deep-link hydration
  246 |  * failure, and fail if even THAT exceeds `budget`.
  247 |  *
  248 |  * `budget: 0` is for `/`, which is prerendered: the client renders what the
  249 |  * server wrote, so there is nothing to hydrate against and zero is the honest
  250 |  * expectation (docs/14 L1 row: "`/` 0 console errors, every deep link exactly 1").
  251 |  */
  252 | export function assertOnlyHydration(watch: ErrorWatch, budget: number): void {
  253 |   const hydration = watch.errors.filter((line) => HYDRATION.test(line))
  254 |   const other = watch.errors.filter((line) => !HYDRATION.test(line))
  255 |   expect(other, 'console/page errors other than the documented deep-link hydration failure').toEqual([])
> 256 |   expect(hydration.length, 'hydration errors').toBeLessThanOrEqual(budget)
      |                                                ^ Error: hydration errors
  257 | }
  258 | 
```