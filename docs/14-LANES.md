# 14 — Lane Board (live claims — one line per agent)

> Every agent claims ONE lane before editing and releases it when done.
> Protocol + prompts: `docs/13-COLLAB-CONTRACT.md`.

| Lane | Surface | Owner (platform/agent) | State | Notes |
|---|---|---|---|---|
| L1 | PWA shell + design system + Cloudflare deploy | Cline | done. Icons, install screenshots, manifest and the keyless deploy all shipped — live at https://seatswap.ayodhya-711.workers.dev. (4) **Deploy: found why Cloudflare refused the build.** Workers Static Assets reads `_redirects` itself and rejects the Netlify/Surge catch-all `/* /index.html 200` as an infinite loop (API error 100324 — it normalises the destination to `/`, which re-matches its own splat), and there is no wrangler escape hatch: `[assets] exclude` is not a supported key (wrangler 4.143: "Unexpected fields found in assets field"). So `postbuild.mjs` stages `dist/cf` = the build minus `_redirects` (`not_found_handling = "single-page-application"` IS Cloudflare's SPA fallback, and `_headers` is kept), and `verify-dist` checks that staging dir so a bad one fails at build time instead of at the next deploy. Deployed and re-checked live: shell, deep link, manifest (`id`, 2 shortcuts, 2 screenshots), screenshots, `sw.js` and the maskable icon all 200. (3) **The screenshot generator was quietly shipping two identical error pages.** `chrome --screenshot` hung on hydration, so the generator moved onto CDP (`Page.navigate` → readiness via `Runtime.evaluate` → `Page.captureScreenshot`); the last mile was a lie in the harness — `--host-resolver-rules=MAP * ~NOTFOUND` also blocked our own 127.0.0.1 static server, so every "screenshot" was Chrome's DNS-error page and both PNGs were byte-identical (64 664 bytes each). Fixed three ways: exclude loopback from the resolver rules, wait for `location.pathname` + non-empty `<main>` instead of `Page.loadEventFired` (a late duplicate load event satisfied the next shot's wait and captured the previous page), and refuse to write any shot whose SHA-256 matches an earlier one. Both shots are now distinct real screens (decoded: 317 / 430 distinct colours, brand green present) and `verify-dist` reads each PNG's IHDR, so the manifest cannot claim a size the file lacks — mutation-checked against the built manifest. (2) Manifest: `screenshots` generated from real captures into `pwa.assets.mjs` (+ `pwa.assets.d.mts` so `vite.config.ts` stays typed), plus `id: "/"` and two launcher shortcuts; all three guarded in `verify-dist.mjs`. (1) L7's request: `.app-column`'s 34rem clamp left /admin ~300px of content at 1180px, so the shell now drops the clamp for /admin only, via the existing `isAdminRoute(useLocation().pathname)` — measured `<main>` 1180px (sidebar 224px) while `/`, `/swaps` and `/trips/add` stay 544px, and hydration error counts are unchanged (`/` 0 console errors, every deep link exactly 1, before and after — that deep-link failure is L9's shell-prerender finding, not this change). Gate: tsc + 504/504 tests + build, all green. |
| L2 | Trips + PNR | OpenCode/Muse Spark | done. (2) **Design parity, Home (backlog 3).** One route was rendering design 25a and design 1a at once: the headline, core-value paragraph, PNR field, SMS-paste link and ₹50 card all sat **above** "Your trips", so on a 360 px phone the list of trains a traveller is actually travelling on started ~1100 px down, behind a form they no longer needs to fill in. Captured in real headless Chrome at 390×844 (seeded through the app's own localStorage keys) and split by state: trips → brand strapline + "Your trips" + cards + FAB; no trips → the 25a pitch. Also design-1a details: `RouteChrome.tagline` renders the strapline inside the header block (bar grows, content does not move; en + hi copy) and each trip card gained a chevron, because the card is a link. **Two design details deliberately not matched, because matching them would mean inventing data:** the design's station *names* ("New Delhi → Bhopal") — the repo has no station dictionary, only codes — and its "3 open to swap" pill, which counts peer rows that do not exist on the local path (backlog 6). The card shows what is true: codes, and the traveller's own open/waitlist status. Guarded in `tests/qa-layout-offline.test.ts` (branch order *is* the behaviour, plus strapline-on-Home-only). Previously: Trips/add/berth/WL/RAC/CAN/quota screens verified vs designs; multi-passenger SMS fill + P-label coach fix |
| L3 | Requests + matching | WorkBuddy/Claude | done. Instrumented the zero-match dead end: `routes/request.$id.matches.tsx` now logs `matches_viewed { matches, capped }` once per request per session, which is what makes design 23's "First on their train today" donut measurable — and records `capped` so a spent send budget is not miscounted as a dead end. Previously: Daily caps wired, acceptor Settings filters now applied on the incoming path, connecting-only journeys no longer match |
| L4 | Payments (Razorpay/PayPal/credit) | WorkBuddy/Fo | done. (2) Closed the hole L4 itself filed: the child pay screens render through the parent's bare `<Outlet/>`, so the rule-2 guard living inside `PayScreen` never ran for `/method`, `/paypal`, `/upi` or `/status` — a settled swap still **rendered** a working "Pay ₹99" and only refused on tap. Refusing on tap is not the same as not offering. The gate is now one function, `payGateFor(targetId)` in `lib/checkout.ts`, because a pay URL can carry either a swap request id or a `grp_…` trip id and the two have different notions of already-paid (`locked`/`confirmed`/`disputed` vs `group.paid`) — that branching was the reason the guard was inline in a screen in the first place, and the reason L4's own note warned that getting it wrong in a route is caught by no test. Each child screen now calls it after its hooks and renders the shared `PayBlocked` (same copy, same never-a-dead-end links, no new i18n keys) when the answer is not `payable`. Three deliberate calls: the PayPal **return leg** keeps its capture effect above the gate, so an order the payer already authorised still settles and only the button is withdrawn; the **failed**-payment path is untouched, since a failed payment leaves the request payable and must still reach the retry buttons; and `done` keeps its own stricter gate (a paid payment *row*, not a status). `payGate(status)` is gone — one definition, as the comment there always claimed. New `tests/pay-gate.test.ts`: behaviour for `payGateFor` across payable / paid / not-yet / missing and for a group id both before and after `markGroupPaid`, including that an unknown `grp_…` reports `missing` rather than offering ₹199 for a trip that does not exist; plus a source guard walking every screen under the pay layout that fails the moment a new one is added without the gate, which is exactly how this hole appeared. Mutation-checked by deleting each gate in turn. Previously: Rule 2 enforced on the local path: a group-covered swap can no longer be charged a second ₹99 |
| L5 | Swaps + chat + safety | OpenCode/Muse Spark | done. Confirm/cancel persist, earned routing, meet records, ratings persist+score+gated, chat report parties, real-row receipts, guard Hindi/leet hardening, integration vs L3/L4/L6 green |
| L6 | Groups + onboard | Pixel Canary/Claude | active: 2026-09-28T11:28Z | designs 52/53/34 parity + group rule audit; `routes/groups.*`, `routes/onboard.*`, `lib/groups.ts`. Previously: `groupTogetherCount` now reports the biggest same-train/date/coach cluster instead of whichever trip was linked first; GROUP_MAX_SWAPS audited — consistent at all five sites |
| L7 | Admin | WorkBuddy/Claude | done. Nine passes. (9) **Design 15's table** — Train in its own column, an icon per category and a colour per tone — and the three things building it exposed. (a) The row colour is **tone, not topic.** Design 15 tints by subject (a blue paper-plane for a request, purple for a payment) and this theme has no blue and no purple — four semantic tokens only (`primary` green, `accent` amber, `danger` red, `muted` grey), and inventing three more to decorate a table breaks the "semantic tokens only" rule for no information. So the two channels each do one job: the **icon** carries the category (the same taxonomy as the filter chips, so the icon predicts the chip) and the **tone** carries outcome — green when the swap happened or money arrived, amber when a limit stopped something or an operator intervened, red for a failed payment, a back-out or a safety action, grey otherwise. The map is sparse and defaults to neutral, so a new action is grey until someone decides it is not, and `tonedActions()` backs a drift guard that fails if a key is not a real action — mutation-checked, a `payment_paidd` typo fails it by name. (b) **Details printed the train number twice** the moment Train got its own column, so `activityDetails` now takes `{ omit }`: the same number twice in one row reads as two facts. (c) The When column shows the date **and** the time. Design 15 shows "22:41" alone only because all six of its rows are one evening; a log that cannot order two events on the same day is not an audit trail. One DOM, two layouts — `grid-cols` + explicit `col-start` on both sides of `lg`, with `lg:contents` dissolving the meta line into its own columns — so the phone card list and the desktop table cannot drift apart. **Two of the design's five columns are still unbuildable** (User, and the User-timeline panel): `ActivityRow` has no name field — the same missing-peer-rows blocker as `admin.users.tsx` and `get_matches()`. Verified in headless Chrome at 390px and 1180px: `main` is 1180px on `/admin` (L1's clamp removal, my request, shipped), all four tones distinct in *computed* styles, one icon column, one train column, no rect overlap, no console errors. **The first screenshot caught a layout bug no text-only probe could see** — leaving the icon and label to grid auto-placement made the Action cell change columns on rows with no train, because the item count changes and the fill order changes with it — so every child is now placed explicitly, and the probe grew a geometry assertion (rect intersection, not right-edge-vs-left-edge, which false-positives on the phone where the When cell is in a different column). Also corrected a wrong note of mine on the board: `actor_role` is **not** hardcoded — `jobs.ts` writes `support`, `server/admin.ts` writes `admin` — it is simply untranslated. Previously: eight passes. (8) Design 24's credit tiles — and the bug that building them exposed. The Credits screen showed one tile where the design has three; the other two were derivable, so they exist now: **Credit given** (every positive ledger row, ever), **Credit used** (the magnitude of the negative rows) and **Unused balance** (`spendableCreditPaise`, floored at zero). Building them surfaced that `admin.index.tsx` passed `walletTotalPaise: wallet.reduce((n, r) => n + r.amount_paise, 0)` — a sum with **no expiry filter** — into a field documented as "credit still unspent and **unexpired**", so credit that had already lapsed was counted as in circulation. Rather than patch the caller, `AdminOverviewInput` now takes the **ledger** instead of a pre-summed number, which makes the wrong input unrepresentable, and the balance is derived through the canonical `spendableCreditPaise` rather than a second definition that could drift. Mutation-checked (replacing the balance with a bare reduce fails `leaves expired credit out of circulation`). Verified in a real browser: ₹149 given / ₹49 used / ₹1 unused, with `given − used − balance` exactly the expired ₹99 earn. **One tile deliberately not built:** the design's "Expiring this month" — the ledger records a single `usedTotal`, not which earn each spend consumed, so attributing an expiry to a month needs a consumption-order assumption that would invert the tile's meaning. It would be a guess wearing a number's clothes. Previously: seven passes. (7) **Found and fixed the reason the Overview screen never rendered.** `routes/admin._index.tsx` declared `createFileRoute('/admin/_index')`; every other index route in the repo uses a trailing-slash id (`/profile/`, `/swaps/`, `/profile/payments/`, `/request/$id/`, `/groups/$id/`, `/pay/$requestId/`), and a leading underscore is TanStack's marker for a *pathless* route — so the generator emitted `path: ''`, `/admin` matched the admin layout and the `<Outlet/>` stayed empty. `ADMIN_ROUTES[0]` links straight to `/admin`, so the entire design-23 screen — six tiles, the week chart, the donut — was unreachable behind a nav link pointing at it, while typecheck, the full suite and the production build all stayed green. Renamed to `routes/admin.index.tsx` + `createFileRoute('/admin/')`. **Why nothing caught it:** the dead-link guard in `tests/routes.test.ts` had a `norm()` that stripped a trailing `/_index`, so it deliberately treated `/admin/_index` and `/admin` as the same route and passed; that tolerance is now removed. Three new assertions pin the invariant (no id containing `_index`; every index route ends in `/`; the generated tree contains no `path: ''`), all mutation-checked by restoring the broken form — the first attempt had two of the three written wrong and only 1 of 3 fired, which is the whole argument for mutation testing a guard. Also verified the screen end-to-end in a real headless Chrome for the first time (dev server, 1180px viewport, seeded activity): tiles, chart geometry and donut all render correctly — see the L7 → L1 request about the phone-width clamp. Previously: six passes. (1) Overview (design 23): added Accepted / Money in / Credit given and fixed two numbers that were wrong — "Swaps done" counted per-side `confirmation` rows instead of `swap_confirmed`, and "Busiest trains" counted any train-tagged row under a "Swaps done" column; Money in is gross − credit, so credit is never counted as revenue. (2) Activity log (design 15): categorised chips. (3) Activity log: human action labels ("Added PNR", not `pnr_added`), raw action kept as a tooltip. (4) Activity log: Details column, rendered from a 26-field **allow-list** rather than a dump of `meta`, so caller-controlled values (`settings_changed.patch`, free-text `reason`) cannot reach an operator and no future meta key becomes a leak by default. Four guards read `src/` for every `logActivity()` call and fail if an action has no chip, no label in either language, no bounded detail, or a label too long for a row; all four were mutation-checked. (5) Overview: design 23's "Swaps this week" chart. The last point is today and equals `swapsDoneToday` by construction — a test asserts it, because a chart and a tile on the same screen disagreeing about one swap is the defect this lane keeps finding. Days that have not happened are `null`, not `0`, so the line stops at today instead of falling to the floor every Monday. (6) Overview: the "First on their train today" donut, on the metric docs/01 and docs/12 already named — an earlier note claiming it was undefined was wrong and is corrected in backlog 8. It excludes capped searches (a spent send budget is not a dead end), reports `null` rather than 0% when nobody searched, and surfaces both the cap flag and any unreadable count instead of guessing |
| L8 | DB + schema | WorkBuddy/Claude | done. Resolved `get_matches()`' two open questions (row pagination stays; 50 is the server ceiling, 20 the phone's page size) and pinned the note to the SQL with a drift guard. Found that `together_seats` is never populated, making docs/08's "keep-together fit 10" unreachable from both the local stub and the production view — see backlog 9. Previously: Pinned the enum + payments-target contracts with 17 new schema tests (all nine enums already matched); reviewed `get_matches()` and found it is the only path matching can ever take — plus two defects in the unapplied spec |
| L9 | Infra + credits | WorkBuddy/Claude | done. (3) A **CI-able hydration guard** — `tests/hydration.test.tsx`, the repo's first render test. Backlog 12 asked for the cheap browser version; this is the better one, because it runs headless in `green.yml` on every push instead of needing a browser and a dev server. **The hard part was not React, it was the asymmetry:** in a real browser the server process has no localStorage and the client does, but in jsdom there is one process and one module registry, so both renders would see the same state and the bug would hide. The test therefore reproduces the asymmetry explicitly — capture the markup while the store is **empty** (`getServerSnapshot`), populate the store, then hydrate that captured markup. A hook that reads live state now renders a different value from the one in the HTML and React says so. The probe's markup deliberately mirrors `TabBar` (aria-label **and** a conditional badge child), because with the attribute alone React reports only the mild "some attributes … won't be patched up" variant and leaves the server's value in place — the real badge adds a `<span>`, so the mismatch is structural and React discards the tree. Mutation-checked: restoring the original buggy hook fails it with the exact diff seen in production (`+ aria-label="Swaps, 1 new"` / `- aria-label="Swaps"`). A second case asserts the real count appears *after* hydration, so the guard cannot pass by rendering nothing. Two traps cost real time and are recorded below: an unmounted root leaks its pending store re-render into the *next* test (three phantom `act` warnings attributed to the wrong case), and `act` warnings arrive on `console.error` — the very channel the test reads. Also corrected `vitest.config.ts`, whose comment claimed tests covered "rendered screens through the router" when no test rendered anything. Previously: (2) Added the repo's **first e2e capability**: `app/scripts/smoke-routes.mjs` loads the app in headless Chrome, soft-navigates every one of the 58 route URLs, and fails on a blank screen or an uncaught/console error. Result on this tree: **58 probed, 0 blank, 0 errors**. Mutation-checked with a temporary route that rendered nothing and logged an error — it named `/smoke-probe` exactly and exited 1, then the probe was deleted and the tree re-verified green. Its documented blind spot: it would *not* have caught the pathless-route bug that motivated it (that rendered a full sidebar with an empty `<Outlet/>`, so there was plenty of text), which is why `tests/routes.test.ts` guards the route tree and this guards the running app — complements, not substitutes. Not wired into CI; filed as backlog 10 because it needs a browser, and that is a cost/latency call for Ayu. `puppeteer-core` is deliberately not a project dependency, so no lockfile churn. Previously: pinned the vitest pool in `app/vitest.config.ts` so the documented green gate works again — `npm run test` runs the whole suite with no flags (31 files, ~3m30s). The test *count* moves as lanes add tests; what matters is "Test Files 31 passed", since a wrong pool silently drops files while reporting success |
| L10 | i18n (single writer) | WorkBuddy/Claude | done. (5) The dead-end metric: `admin.firstOnTrain`, `firstOnTrainNone` (the null state), `firstOnTrainUnknown`, and the `matches_viewed` action label — en + hi. Previously: (4) Design 23's chart: `admin.chartSwaps` (en+hi), plus `localeFor()` — the `lang` → BCP-47 mapping now lives in one place, so shipping a third language is a one-line change instead of a hunt for every `lang === 'hi'` — and `formatWeekday()`, which derives weekday labels from `Intl` rather than a `weekdays` block in all 22 catalogues. `formatTripDate()` was refactored onto `localeFor()`. Previously: (1) Overview tile copy for the L7 metric fix: `s_accepted`, `s_swaps_done`, `s_money_in`, `s_credit_given`, `moneyInUnknown`, `colTrain`/`colTrainName`/`colSwapsDone` (en+hi); removed `s_confirmed`, whose label described the old per-side count. (2) Activity category chips: `catAll`, `catLabel`, `catTrips`, `catRequests`, `catSignins`, `catAccount`, `catOther` — Payments/Swaps/Reports chips reuse the sidebar's own keys so the two cannot drift. (3) `admin.act.*`: 49 action labels in both languages, keyed by action name so the naming convention is the mapping |

Lane states: `free` → `active: <agent, time>` → `done. <one-line summary>`.

## Requests (cross-lane needs)

- `<date> <lane> → <lane>: <what you need>` — owner replies with `ack` or `done`.
- 2026-09-28 L5 → L3: chat report/block needs the acceptor's *user* id.
  Local `SwapOffer` carries only `acceptor_trip_id`, so the L5 chat screen
  reports `trip:<id>` (explicit, joinable later) instead of a fake user id.
  When offers gain a server user id (step-3 sync), prefer it there.
- 2026-09-28 L4 → L1 (and every lane): commit `0c5f882` is a blanket
  `git add -A` under the message `0`. It swept four lanes into one commit —
  L1's icons/scripts, L5's *in-flight* ratings work (`lib/store.ts`,
  `lib/requests.ts`, `tests/store.test.ts`), and L4's checkout guard — so
  attribution is gone and L5's half-finished work is now on `main`.
  docs/11 §Scope discipline forbids exactly this ("never `git add -A` a tree
  containing other agents' in-flight work"), and §Commit messages forbids
  one-character messages. Please go back to path-scoped adds; the tree was
  green when it was swept, but that was luck, not the protocol working.
- 2026-09-28 Cline → every lane: **it happened a second time** — commit
  `5b77069`, message `0`, another blanket `git add -A`. It swept L1's
  screenshot/manifest work, L6's in-flight `lib/groups.ts`, and five
  `.tanstack/tmp` build artefacts onto `main`. L1's own work survived intact
  (verified pixel-by-pixel and by a live deploy before the sweep), but the
  attribution problem above is now the normal state of the history rather than
  an exception, and `dist`-adjacent junk keeps landing in commits. Worth a
  `pre-commit` hook that rejects `git add -A` or a one-character subject; the
  protocol text alone has now failed twice.
- 2026-09-28 L3 → L8/L9 (server match query): the acceptor **inbound** daily
  cap (`max_requests_per_day`, docs/03, default 3) is enforced by
  `rankMatches` but nothing feeds it `received_today` — the local pool is this
  device's own trips, so filling that in from local state would invent other
  travellers' settings (it broke the ₹199 group flow, which legitimately sends
  several requests to one open trip). Needs real peer rows:
  `app/azure/load/get-matches.*`.
- 2026-09-28 L4 → whoever owns `pay.$requestId.*`: the child pay routes render
  through the parent's `<Outlet/>`, so the rule-2 guard in `PayScreen` never
  runs for `/pay/$requestId/method`, `/paypal`, `/status` or `/done`. The money
  hole is closed in `lib/checkout` now, but a settled swap still *renders* a
  live "Pay ₹99" UI there and only refuses on tap (with the right copy). A gate
  on the child screens would be the honest fix; left out of L4's commit because
  the group flow branches on `isGroupRequestId` and getting that wrong in a
  route is not caught by any test.
  **done, L4, 2026-09-28.** The gate is `payGateFor()` in `lib/checkout.ts` and
  every child screen renders `PayBlocked` when it is not `payable`; the group
  branching is in the one function and pinned by `tests/pay-gate.test.ts`,
  including the unknown-`grp_` case that used to read as payable.
- 2026-09-28 L3/L6 → L9 (test runner): **done, L9, 2026-09-28.** `npm run test`
  — the green gate AGENTS.md §0 step 4 requires before every commit — did not
  run on this machine as configured, though the suite itself was fine. Default
  `forks` pool with unbounded workers: `Timeout waiting for worker to respond`
  on every file, 180s, zero tests executed. The cause is ~50s of jsdom
  construction per file (`tests/setup.ts` is 17 trivial lines) multiplied by
  too many concurrent worker boots, not our code. `pool: 'forks'` +
  `maxWorkers: 4` is now pinned in **`app/vitest.config.ts`** — note that is a
  dedicated file, *not* `vite.config.ts`, which has no `test` block — and
  `npm run test` is green with no flags (31 files / 421 tests, ~4m).
  Two traps, both still worth knowing: `--pool=threads` with parallel files
  **silently loses ~22 of 31 files** while reporting success, so always check
  the "Test Files N passed" count; and `--no-file-parallelism` runs but pays
  the per-file cost serially (~27 min).
  **Follow-up:** `app/vitest.config.ts` is in no lane's ownership map (docs/13
  §1 lists `package.json`, `routeTree.gen.ts` and `app/vite.config.ts` as the
  shared files, but not this one). It should be added there — an unowned shared
  config is exactly how the gate stayed broken long enough for three lanes to
  file the same complaint.

- 2026-09-28 L4 → L1 (`app/src/components/app-shell.tsx`): `npm run test` is
  red on this tree with **one** failure, and it is not in any lane's new work:
  `tests/qa-layout-offline.test.ts:75` expects `/inColumn && 'app-column'/` in
  `app-shell.tsx`, which currently renders an unconditional
  `className="app-column flex min-h-dvh flex-col"`. So either the shell lost
  the admin-width conditional or the guard is now describing a shape L1 has
  moved past — L1 is `active`, so this is L1's call, not a drive-by fix.
  Everything else is green (33 files, 514 of 515 tests), typecheck clean and
  `npm run build` clean including `verify-dist`.

- 2026-09-28 L8 → whoever owns `lib/store.ts` + `lib/checkout.ts`: a group
  payment cannot be represented the way the database requires. `payments` has
  `request_id uuid REFERENCES swap_requests` **and** `group_id uuid REFERENCES
  group_trips`, with `payments_target CHECK ((request_id IS NULL) != (group_id
  IS NULL))` — exactly one target. But the local-first `PaymentRow` has only
  `request_id` and no `group_id`, and `beginGroupCheckout()` passes the group id
  into it. Group ids are `grp_<base36>_<rand>` strings (`lib/groups.ts`), so the
  value is neither a uuid nor a row in `swap_requests`: the insert would fail on
  the cast, and on the FK even if it parsed. Local-only today, so nothing is
  broken — it breaks the moment group payments sync, and it is the same
  "local path and server enforce identical invariants" claim that L4 found false
  for rule 2. Fix shape: `PaymentRow.group_id: string | null`, `request_id:
  string | null`, `startPayment()` sets whichever target it was given, and
  `paymentFor(targetId)` matches on either column (it is the lookup that makes
  the current overload load-bearing). Left unfixed because it spans
  `lib/store.ts` and `lib/checkout.ts` and there is no database here to verify
  the mapping against; recorded in `tests/schema.test.ts` next to the
  `payments_target` assertions.

- 2026-09-28 L7 → L2 (owns `lib/store.ts`): **touched it, 3 lines.** `payment_paid`
  logged `{ provider, amount_paise }` — the GROSS price — and dropped
  `credit_used_paise`, so the audit row claimed ₹99 collected on a payment
  where credit covered part of it and the gateway captured less. docs/08 makes
  the activity log the system of record, so any later money metric reading it
  overstates collections. The row (and the `payment_paid` analytics event) now
  carry `credit_used_paise`. Additive only — no behaviour change, no signature
  change. L2 was `done`, so this did not collide; flagging it because the file
  is L2's.
- 2026-09-28 L7 → L4 (payments): the analytics event `payment_paid` now carries
  `credit_used_paise` alongside `amount_paise`, for the same reason as above —
  a PostHog money panel summing `amount_paise` would count credit as revenue.
  Separate, unrelated drift noticed while in there: `routes/swaps.$id.done.tsx`
  fires a **second** `trackEvent('payment_paid', { state })` with a completely
  different payload shape from `store.setPaymentStatus`'s
  `{ amount_paise, credit_used_paise }`. One event name, two shapes, so any
  dashboard grouping by event name silently mixes them. Left alone — it is
  L5's route and changing an analytics contract is a product call, not a
  drive-by.
- 2026-09-28 L7 → L2 + whoever owns `routes/profile.settings.tsx`: **log meta
  carries two caller-controlled values**, found while building design 15's
  Details column.
  1. `settings_changed` logs its `patch` object **verbatim**
     (`routes/profile.settings.tsx`: `logActivity('settings_changed', patch)`).
     Whatever keys a future setting has land in the audit log unexamined — so
     the day a setting holds an email or a phone, it is in `activity_log`
     without anyone deciding that. Worth logging an explicit allow-list of
     changed keys instead of the raw patch.
  2. `report_filed.reason` and `admin_action.reason` are free text by type
     (`ReportInput.reason?: string`; the two admin consoles pass
     `reason.trim()` from an operator-typed Input). Today the only
     `report_filed` caller passes the literal `'User reported from chat'`, so
     nothing leaks yet — but the *type* allows a transcript, and a transcript
     can contain a phone number or a UPI id, which is exactly what
     `lib/chat-guard.ts` exists to hide.
  Neither is a bug today and neither is mine to fix — `activity_log` is the
  system of record, so widening it is an L2 decision. L7's Details column reads
  an **allow-list** rather than `meta`, so it cannot surface either one; the
  tests stuff a fake PNR, email, phone and name into unlisted keys and assert
  none of them reaches the row.
  Separately: **`routes/profile.*` is in no lane's ownership map** (docs/13 §1).
  Same gap as `app/vitest.config.ts`, filed under L9. Two unowned files is a
  pattern, not a coincidence.
- 2026-09-28 L7 → L1 (owns `components/**` + `styles.css`): **the admin console
  is clamped to phone width, so design 23 cannot be matched.** `AppShell` wraps
  every screen in `<div class="app-column …">`, and `.app-column` is
  `max-width: 34rem` (544px). `routes/admin.tsx` says in its own comment that
  this is "a desktop tool, so it draws its own sidebar and header", and lays
  itself out with `lg:flex lg:gap-6` + a `lg:w-56` sidebar + `lg:flex-1`
  content. At a 1180px viewport the `lg:` rules do fire, so the sidebar takes
  224px out of a 544px column and the content gets ~300px: the six Overview
  tiles wrap onto three lines each and the week chart is illegible.
  `designs/23 Admin overview.jpg` is a ~1080px console — sidebar, six tiles in
  one row, chart beside the table.
  Verified in a real browser at a 1180px viewport on `/admin`: the entire
  console occupies the left ~40% of the window and the rest is empty. (The
  chart, donut and tiles all render correctly — this is purely the container.)
  Fix is yours to choose: let a route opt out of the column (e.g. `setup`
  chrome or an admin flag skips `app-column`), or give `.app-column` a wider
  `lg:` max-width. Not edited by me — `components/**` and `styles.css` are L1's
  and L1 is `active`.
  → **ack + done 2026-09-28 (L1), first option.** `AppShell` keeps
  `.app-column` for every passenger screen and drops it for `/admin*` through
  the existing `isAdminRoute(useLocation().pathname)` — a route-level opt-out
  rather than a wider clamp for everyone, because phone-first is the product
  design. Re-measured in headless Chrome at 1180px: the console's `<main>` is
  1180px (sidebar 224px), and `/`, `/swaps` and `/trips/add` are still 544px.
  Guarded both ways in `tests/qa-layout-offline.test.ts` and mutation-checked
  by dropping `inColumn &&`. One honest caveat: the SPA shell is prerendered at
  `/`, so a direct `/admin` load already fails hydration once on its own chrome
  — that is L9's finding, and this change adds nothing to it (`/` 0 console
  errors, every deep link exactly 1, before and after).
  Related, and **mine not yours**: design 23 also shows a header (wordmark,
  "Admin", bell, avatar) and `setup` chrome renders no top bar at all, so the
  admin console currently draws no header. Tracked as L7 design-parity work.
- 2026-09-28 L7 → L9 (repo hygiene; `.gitignore` is in no lane's map):
  **`app/.tanstack/` is not gitignored.** The TanStack Router dev server writes
  UUID-named temp copies of `routeTree.gen.ts` and route modules into
  `app/.tanstack/tmp/`, so every dev session leaves 4–5 untracked files that
  `git status` shows as `??` and that a careless `git add -A` would commit.
  One present here is dated 2026-09-26, so this is long-standing, not new.
  Add `app/.tanstack/` to `.gitignore`. Worth pairing with the other two
  unowned-file findings below — `app/vitest.config.ts` and `routes/profile.*`.
- 2026-09-28 L7 → L3 (owns `lib/requests.ts`; L3 was `done`, so no collision):
  **fixed a hydration bug in the Swaps-tab badge, found while verifying L7.**
  `useUnreadUpdates()` in `lib/use-store.ts` called `useAppState()` and
  `useRequestsState()` for their *subscriptions* and then **discarded both
  return values**, rendering `unreadUpdates()` instead — a direct read of module
  state. That state is populated from `localStorage` at module load, so the
  client's first render already had data, while `getServerSnapshot()`
  deliberately returns an empty state. React therefore saw a badge the server
  had not written and **regenerated the entire tree on every page load**:
  `+ aria-label="Swaps, 2 new"` / `- aria-label="Swaps"`.
  It was the only hook in that file doing it — every sibling (`useCreditPaise`,
  `useSeenFlag`, `usePaymentFor`, `useSwapRequest`, …) reads from the subscribed
  snapshot — which is exactly why it went unnoticed.
  Fix: `updates()` was split into a **pure** `updatesFrom(state, app, at)` plus a
  thin `updates()`, and a new `unreadUpdatesFor(app, requests, at)` derives the
  rows from the snapshots the hook already holds. `updates()` keeps its
  signature, so `markAllUpdatesRead` and every other imperative caller are
  untouched. Three tests in `tests/requests.test.ts` pin the property that makes
  the bug impossible; both halves were mutation-checked and each fails its own
  named test (reading the live requests state; reading the live `seen` map).
  **Worth knowing for anyone verifying this app:** *only the shell is
  server-rendered.* `curl` of `/` and of `/admin/credits` both show an empty
  Suspense boundary in `<main>` — route content renders after hydration in SPA
  mode. So a *route-level* hydration mismatch cannot occur, and the shell is the
  entire surface where one can. `useI18n` and `useOnline` already follow the
  right pattern deliberately (`lib/i18n.tsx` says so in a comment, and
  `BOOT_SCRIPT` exists for the same reason); `useUnreadUpdates` was the one
  place that did not.

- 2026-09-28 L7 → L10: **`admin.searchPh` names a capability the screen cannot
  have.** It reads "Search action, user or train" (hi: "कार्रवाई, उपयोगकर्ता या
  ट्रेन खोजें"), and the `user` third is false. `filterActivity` builds its
  haystack from `[actor_id, action, entity, entity_id, JSON.stringify(meta)]` —
  `actor_id` is an opaque account id, never a name, and `ActivityRow` has no
  name field at all (the same missing-peer-row blocker as `admin.users.tsx` and
  `get_matches()`). So an operator who types a name the placeholder invited gets
  an empty screen and no reason why. The train third is real (`train_no` lives
  inside `meta`, and all of `meta` is stringified in). Please reword the
  placeholder to what actually works — action, train, or the masked PNR tail —
  in both languages. Not urgent: it is copy, not a crash, and it is the
  *placeholder* only; the same string is also the `Field` label above it, so one
  key fixes both.

- 2026-09-28 L7 → L10: **`actor_role` renders an untranslated English token.**
  Design 15's activity table now shows `support` and `admin` as tokens on the
  row (passenger rows show nothing, since `user` is the uninformative default).
  Those are real values — `server/jobs.ts` writes `support` for the cron jobs
  and `server/admin.ts` writes `admin` — but they are English words, not codes
  like `razorpay` or `3A`, so the Details column's "deliberately
  language-neutral" argument does not cover them. Three keys
  (`admin.role.user|admin|support`) would close it. Low priority: it is one word
  per row, and only on rows a passenger never sees.

## Backlog (unclaimed, ready to pull)

1. ~~L1: real app icons, `screenshots/` for install UI, manifest `id/shortcuts/screenshots`.~~ **done 2026-09-28 (L1).** Real icon set (deterministic zero-dependency generator: `scripts/png.mjs` + `scripts/make-icons.mjs` → 192/512/maskable/apple-touch, full-bleed alpha verified); `screenshots/` captured from the real build by `scripts/make-screenshots.mjs` and declared through `pwa.assets.mjs`; manifest gained `id`, two `shortcuts` and `screenshots`, each guarded in `scripts/verify-dist.mjs` (IHDR size, `form_factor`, label, shortcut URL and icon existence).
2. ~~L1: Cloudflare deploy run — `npx wrangler deploy` (keyless; secrets later).~~ **done 2026-09-28 (L1).** Deployed keyless to https://seatswap.ayodhya-711.workers.dev and re-checked it live. The only blocker was Cloudflare reading `_redirects` (see the L1 row); the deploy ships no secrets by design, so Supabase / Razorpay / PayPal / VAPID stay unset and the app runs local-first until `wrangler secret put`.
3. L2–L7: design parity pass vs `designs/01-29.jpg` (`docs/05` mapping). — **L2
   half done 2026-09-28 (screens 1/4: `designs/01` 1a + `designs/25` 25a; Home
   now branches by state, see the L2 row).** The method that found it is worth
   reusing: build, serve `dist/client`, seed the app's own `localStorage` keys
   and screenshot the real route in headless Chrome, then hold the design image
   and the capture side by side. Reading the route's JSX is not a substitute —
   the Home defect was visible in the markup only after the two were compared.
   Remaining: L3 (matches/send), L4 (pay/₹99), L5 (accept/chat/confirm) — L6 and
   L7 are `active`, so leave those surfaces alone.
4. L7: admin **design parity** vs `designs/15-18,23,24` — **partly done,
   2026-09-28 (L7 + L10).** Design 23's numbers now exist and mean what the
   design says. Three of them were wrong, not merely missing:
   - **Money in** was absent. Added as `moneyInTodayPaise`, defined the way
     `checkout.ticket()` already defines it: `max(0, amount_paise −
     credit_used_paise)`. Summing `amount_paise` would have counted credit as
     revenue — ₹99 charged with ₹50 of credit collected is ₹49 in the bank.
     A paid row whose credit portion cannot be read is excluded and counted in
     `moneyInUnknownToday` rather than assumed to be a full collection.
   - **Swaps done** counted the `confirmation` action. That row is written once
     **per side** (docs/02 keys `confirmations` on `(request_id,user_id)`) and
     `recordConfirmation` allows re-answering, so one swap could log three rows
     and a half-answered swap logged one. Now counts `swap_confirmed`, which
     `settleRequest` writes once on the locked→confirmed edge. `lib/requests.ts`
     already said so in a comment at the `settleRequest` call site — the metric
     just never matched it.
   - **Busiest trains** counted every row carrying a `train_no`, which includes
     `pnr_added` and the chart toggle — "busiest by any activity" under a column
     headed "Swaps done". Now counts confirmed swaps only, attributed
     `swap_confirmed → swap_requests.trip_id → trips.train_no`, and carries the
     design's **Train name** column.
   Added `acceptedToday` (`offer_accepted`) and `creditGivenTodayPaise` (credit
   *issued* today, distinct from `creditInCirculationPaise`, the outstanding
   balance). `usersToCsv` / `AdminUserRow` gained design 16's Trips / Swaps /
   Credit columns, in paise.
   **Design 15, 2026-09-28 (L7, pass 4):** the **Details column** now exists
   (`activityDetails()`), rendered from a 26-entry allow-list instead of the
   raw `meta` object. Two of the ~50 `logActivity()` call sites carry
   caller-controlled values — `settings_changed` stores whatever `patch` object
   it was handed, and `report_filed` / `admin_action` store free-text
   `reason` — so a wholesale `meta` render would have put both in front of an
   operator, and would have silently started showing any field a future call
   site adds. The mask on `last4` is a *safety property*, not a formatter: even
   if a call site logged a full 10-digit PNR under that key, only four
   characters can reach the row. Deliberately language-neutral (bare values,
   `·` separators) — a secondary column does not justify ~10 English glue keys
   in all 22 languages; money is the one exception and goes through
   `formatRupees`.
   **Still open, deliberately:**
   - `admin.users.tsx` renders one row (the signed-in account or
     `local-device`) with no search box and none of the All / Active today /
     Reported / Blocked chips. This is **not** a layout gap to close by
     writing chrome: with no backend there is one local user, so a search box
     and four status chips would filter a single row. It becomes real work when
     peer rows exist (`azure/load/get-matches.*`, backlog 6), not before.
   - Design 23's "Swaps this week" line chart and the "First on their train
     today" donut were both absent here. **Both shipped later the same day** —
     see item 8, which also corrects the claim made in this spot that the donut
     "needs a metric nobody has defined yet". The metric was defined; what was
     missing was the instrumentation to count it.
   - Design 15's categorised activity filter (All / Requests / Payments /
     Swaps / Reports / Sign-ins) **shipped** in pass 2 as chips; the flat
     action dropdown is gone. What remains from design 15 is the **table
     layout** (Time / User / Action / Train / Details — currently a list of
     label + details + `date · role`) and the right-hand **User timeline**
     panel. Left alone deliberately: both are chrome over data that already
     renders, whereas the Details *contents* were derivable and therefore
     worth building and testing. Search, export, and the category chips all
     exist.
   - Designs 17/18/24 (swaps, payments+reports, credits tables and their
     right-hand detail panels) were not touched at all.
5. L9: Azure burn-down dry-runs (`app/azure/`), PostHog/Sentry key plumbing (env only).
6. L8: **`get_matches()` is the only path by which matching can ever work** —
   reviewed 2026-09-28, still not applied. part 7 drops every `*_match_read`
   policy and makes `match_cards` `security_invoker`, so a client `SELECT` on
   the view returns only the caller's own rows. That is rule 13 working, but it
   means cross-user matching needs a function running with elevated rights —
   which is what `SECURITY DEFINER` on `get_matches()` is for. So this is not
   "hot-train scale work"; it is load-bearing for the core feature.
   Two defects were corrected in `app/azure/load/get-matches.spec-part2.sql`
   during review: `p_after` was `timestamptz` compared against `booking_id`
   `uuid` (no such operator; `LANGUAGE sql` bodies are validated at CREATE, so
   the migration would have failed outright — the `REVOKE`/`GRANT` signatures
   had to change with it), and it promised "newest-first" rows that
   `match_cards` cannot support because the view exposes no `created_at`.
   The overstated comment claiming it enforces the overlapping-segment,
   blocked/paused, daily-cap, filter and quota rules was corrected too — those
   stay in `rankMatches()`. Part 1's indexes were verified column-by-column and
   are correct as written.
   **Both open questions resolved, 2026-09-28.** Row-based pagination stays.
   - *Booking split across pages.* Harmless — but **not** for the reason the
     note gave ("the client regroups by booking_id"; that only helps if the
     client already holds every page, which a first render does not). The real
     reason is that `match_cards` exposes no per-booking seat count, so the
     client cannot infer anything from how many rows of a booking it received.
     That is a constraint on the future fix, not a licence: if seat counts are
     ever added for the keep-together score, they must be a **per-row** column
     (every row carrying the booking's full count), never a client-side count
     of rows received. Per-row keeps splitting harmless by construction.
   - *50-row clamp vs "never more than 20 rows on a phone".* Both stand, as
     different things: **50 is the server's abuse ceiling** (what no caller can
     exceed), **20 is the phone client's page size** (a payload choice the
     server has no business encoding — it cannot know the device, and a desktop
     caller may want more). The contract note now says that instead of
     presenting them as a contradiction.
   A drift guard in `tests/azure-burndown.test.ts` now pins the note to the SQL
   — the clamp values, the signature, `p_after` staying a `uuid`, and the
   function staying a *narrowing* query rather than a second copy of
   `rankMatches`. **Still not applied, and still not verifiable here**: there is
   no Postgres in this environment, so the SQL has been reviewed and pinned but
   never executed. Apply as a SECOND migration file — `tests/schema.test.ts`
   only compares the init migration to `schema.sql` and never enumerates the
   directory, so no `schema.sql` edit is needed. The old header claim that the
   schema test blocked this was wrong.
9. **`together_seats` is never populated, so docs/08's "keep-together fit 10" is
   a score component that cannot fire.** Found 2026-09-28 while resolving item 6.
   The evidence chain, all of it checked:
   - `docs/08-PWA-AND-TECH.md` line 19 specifies the score as "choice rank (1st
     50, 2nd 35, 3rd 20) + same coach 10 + **keep-together fit 10** + acceptor
     rating 0–10".
   - `lib/matching.ts` line 159 awards it: `if (request.keep_together &&
     (cand.together_seats ?? 1) >= (request.group_size ?? 1)) score +=
     KEEP_TOGETHER_POINTS`.
   - `CandidateSpec.together_seats` is optional and **nothing in `src/` ever
     assigns it** — `candidateFor()` in `lib/requests.ts` omits the field.
   - It is not a local-stub gap either: the production view `match_cards`
     (`supabase/schema.part7.sql`) exposes `booking_id, train_no, train_name,
     journey_date, from_code, to_code, class, is_chair_car, passenger_id,
     label, coach, berth_type, status, quota, first_name, last_initial` — **no
     seat count of any kind**. So the backend cannot supply it as the schema
     stands.
   - `tests/matching.test.ts` proves the bonus works *given* `together_seats: 2`,
     a value no production path can produce. The test passes on data that cannot
     occur, which is why this went unnoticed.
   A tripwire in `tests/matching.test.ts` now pins the gap (it fails, naming
   `lib/requests.ts`, the moment anyone wires the field) and asserts the view
   still has no seat column. **The fix needs a decision this lane should not
   make alone:** what does "together" mean — the count of CNF passengers on the
   booking (computable from the view), or berths that are actually *adjacent*
   (not computable: `match_cards` deliberately exposes no `berth_no`, per rule
   13)? Those differ, and a raw passenger count would overstate a booking whose
   berths are scattered across the coach. Needs an answer from the human or
   from docs/01 before either the schema or `candidateFor` changes.
7. L7: design 15's activity log — **categorised filter done, 2026-09-28.**
   Chips are All / Trips / Requests / Payments / Swaps / Reports / Sign-ins /
   Account, plus an **Other** chip that appears *only* when something is
   uncategorised, so an action added without updating the map is visible
   instead of silently absent from every chip. Trips and Account are additions
   to the design's five: the log really writes trip and settings actions
   (design 15's own table lists "Added PNR") and without them those rows belong
   to no chip.
   The map is built from the actions the code logs, **not** from docs/08's
   list, which omits `swap_confirmed`, `acceptor_backed_out`, `someone_faster`,
   `meet_answered`, `group_*`, `trip_removed` and the welcome/settings actions.
   A test walks `src/` for every `logActivity()` call and fails if one lands in
   `other`; it was mutation-checked (deleting `swap_confirmed` from the map
   fails it with exactly that name). Two scanner details that matter if it is
   ever rewritten: it reads only the **first** argument (later arguments carry
   `'payment'`/`'swap_request'` entity types), and it **skips literals on the
   right of a comparison**, because `status === 'paid' ? 'payment_paid' : …`
   otherwise reports `paid` as an action — and the tempting fix, adding `paid`
   to the map, would be mapping a *value* as if it were an *event*.
   **Human labels done, 2026-09-28.** Rows and the action dropdown now show
   `admin.act.<action>` ("Added PNR", "Sent request", "Accepted") instead of the
   raw identifier, with the identifier kept as a `title` tooltip so a row is
   still greppable against the code. 49 labels in both languages, keyed by
   action name — the naming convention *is* the mapping, so there is no second
   list to keep in step, and the same source walk that guards the chips now
   fails if an action has no label in either language. Mutation-checked
   (deleting `en.admin.act.pnr_added` fails it, naming `en` only — it checks
   each language independently).
   One deliberate deviation: the design's row reads **"Paid ₹99"**, but the
   label is just **"Paid"**. A group payment is ₹199, so a hardcoded ₹99 in the
   label would be wrong on every group payment. The amount belongs in the
   Details column, not in the verb.
   **Details column done, 2026-09-28.** Rows now read label → details →
   `date · role`. `activityDetails()` renders from a 26-entry allow-list, never
   the raw `meta` (see item 4 for why that distinction is load-bearing).
   **Re-examined 2026-09-28 (L9 pass 3), and the earlier note here was too
   optimistic.** It said the table layout and the "User timeline" panel were
   "chrome over data that already renders". Two of the design's five columns
   are not chrome — they are **blocked**, and the evidence is in the code:
   - `logActivity` writes `actor_id: snapshot.settings.user_id` — **one opaque
     account id** — and `actor_role: 'user'` **hardcoded** at its single call
     site, so the `'user' | 'admin' | 'support'` union is aspirational and
     nothing ever writes `'admin'`.
   - `ActivityRow` has **no name field at all**.
   - `designs/15` shows four different named people (Riya P, Arjun S, Meena K,
     Karan B).
   So a **User** column would be one repeated opaque string — less informative
   than the `date · role` line it replaces — and anything else means fabricating
   names, which this repo refuses elsewhere ("never fabricated",
   `revealedBerths`). The **User timeline** panel has the same problem from the
   other end: with a single local actor it is the whole log, which is what the
   table beside it already shows. This is the **same missing-peer-rows blocker**
   as `admin.users.tsx` (item 4) and `get_matches()` (item 6) — three admin
   features now waiting on one thing.
   **Still buildable, and genuinely worth doing:** the table layout itself with
   **Train in its own column** (the design separates it; today it is folded into
   Details) and the per-action **icon + colour** in the Action column, which is
   the design's most distinctive feature and its biggest scanning win. Neither
   needs peer data.
   **One constraint on that table:** `AppShell` clamps every screen to
   `.app-column` (`max-width: 34rem`) and `components/**` is L1's, so a
   five-column table at 544px would repeat the design-23 clamp problem. It wants
   a responsive form — a real table at `lg:`, the current list below — not a
   straight port. The search box, the export button, the action dropdown and the
   chips already exist.
8. L7 + L3: design 23's "Swaps this week" chart **and** the "First on their
   train today" donut — **both done, 2026-09-28.**
   **Correction to this item.** An earlier revision said "first on their train"
   is "undefined anywhere in docs/01-13". That was wrong, and *how* it was wrong
   is the point: it came from a grep for the **chart's** vocabulary ("this
   week", "7-day"), which could never have matched the donut's. The metric is
   named in `docs/01` line 38 (success metrics: "you're the first on this
   train" rate) and `docs/12` line 78 (analytics); the user-facing state is
   defined in `docs/04` line 16 ("0 matches → You're the first on this train")
   and `docs/09` line 17; and it already ships as `firstTitle` plus the card in
   `routes/request.$id.matches.tsx`. **A search that could not have found the
   thing is not evidence that the thing is absent.**
   What was actually missing was not a definition but **instrumentation**: none
   of the 49 logged actions carried a match count, so the tile had no data
   source. Added `matches_viewed { matches, capped }`, written once per request
   per session via the same StrictMode-safe session-flag idiom the payment
   screens use, so numerator and denominator come from one population.
   The exclusion that makes the metric honest: **a capped search is not a dead
   end.** A user whose 10-a-day send budget is spent has not failed to find
   anyone — their pool may be full — and the matches screen already refuses to
   show them the "you're the first" card for precisely that reason. Counting
   them would resurrect the lie the card avoids. `capped` is *recorded*, not
   filtered at the call site, so the cap stays visible in the log; the Overview
   does the excluding. `percent` is **null, not 0**, when nobody searched — 0
   asserts "everyone who looked found someone".
   Two mutations were run: dropping the action from the category map (the
   completeness guard named `matches_viewed` exactly) and inverting the cap
   filter (caught by 6 tests, including the one named for it).
   **The chart** (`swapsThisWeek()`) needed two decisions the design does not
   settle, both recorded in the code:
   - **Which seven days.** The design's axis is Mon→Sun and its title is "this
     week", so it is the **calendar week**, not a rolling 7-day window. The two
     coincide only on a Sunday, so the mockup cannot distinguish them; the
     wording can, and AGENTS.md makes the images the reference for wording.
   - **Future days are `null`, not `0`.** A zero means "the day happened and no
     swap was confirmed"; a day that has not arrived has not happened at all.
     Drawing them as zero drops the line to the floor and leaves it there every
     Monday and Tuesday, which reads as a collapse in swaps rather than as a
     week that has barely started. On a Monday the chart is therefore a single
     dot — thin, but true.
   The load-bearing property is that the last non-null point **is** today and
   counts `swap_confirmed` through the same `localDayKey` the tiles use, so it
   equals `swapsDoneToday` by construction. That was the whole reason to build
   this now: a chart and a tile on the same screen disagreeing about the same
   swap is the defect class this lane keeps finding. A test asserts the two are
   equal, and two mutations were run to prove the tests bite — future days set
   to `0` (caught by 3 tests) and counting `confirmation` instead of
   `swap_confirmed` (caught by 4, including the test named for it).
   Weekday labels come from `Intl` via a new `formatWeekday()`, not from a
   `weekdays` block in all 22 catalogues — the names already ship with the
   platform. `formatTripDate()` now shares the same `localeFor()` helper, which
   removes the second place that knew the `lang` → BCP-47 mapping.

10. **L9 + the human: should the route smoke test run in CI?** The repo now has
    `app/scripts/smoke-routes.mjs` — the first thing in this project that loads
    the app in a real browser. It walks every route URL, soft-navigating the way
    a user does, and fails on a **blank screen** or an **uncaught/console
    error**. Verified 2026-09-28 against the current tree: **58 routes probed,
    0 blank, 0 errors, exit 0.** Mutation-checked by adding a temporary route
    that renders nothing and logs an error: it reported `blank screens: 1`,
    `routes with errors: 1`, named `/smoke-probe` exactly, and exited 1. The
    probe was then deleted and the tree re-verified green.

    **Its blind spot, stated plainly so nobody over-trusts a green run.** It
    would **not** have caught the bug that motivated it. `routes/admin._index.tsx`
    declared a pathless route, so `/admin` rendered the whole admin sidebar with
    an empty `<Outlet/>` — plenty of text, zero errors, and a blank-content
    screen that a length threshold cannot distinguish from a real one. That
    class is covered by the unit assertions in `tests/routes.test.ts` instead
    (no declared id containing `_index`; every index route ends in `/`; no
    `path: ''` in the generated tree). **The two are complements: the unit test
    reads the route tree, the smoke test reads the running app.** Neither
    replaces the other.

    Why it is not wired into CI yet: `green.yml` runs typecheck + test + build +
    collab-check, all headless. This needs a browser binary and a running dev
    server. Options are to install Chromium in the workflow (slower CI, and
    GitHub's cache makes it tolerable) or leave it a local tool run before a
    hand-off. That is a cost/latency call for Ayu, not one to make silently —
    hence this item. `puppeteer-core` is deliberately **not** a project
    dependency, so no lockfile churn; install it wherever you like and the
    script resolves it, printing instructions if it cannot.

    Prerequisite worth knowing: the dev server must be told to bind IPv4
    (`--host 127.0.0.1`), because `vite dev` otherwise listens on `[::1]` only.
    Also `app/scripts/**` is in **no lane's ownership map** (docs/13 §1) —
    joining `app/vitest.config.ts`, `routes/profile.*` and now `app/.tanstack/`.
    **Five** unowned paths, counting `routes/__root.tsx` (item 11): the root
    document, the test-runner config, the script directory and two route trees
    all sit outside the map. That is a pattern worth fixing in the map itself.

11. **L10 + whoever owns `routes/__root.tsx`: the prerendered `lang` attribute
    was a hydration mismatch for every Hindi reader — done 2026-09-28.**
    `BOOT_SCRIPT` sets `document.documentElement.lang = 'hi'` before first paint
    (deliberately, so the document is marked Hindi from the very first frame),
    while `RootDocument` rendered `<html lang="en">` — a bare literal, not
    `DEFAULT_LANG`, even though `DEFAULT_LANG` was already imported for the meta
    tags rendered right beside it.
    React 19 reports this as a **different** error from a structural mismatch:
    "A tree hydrated but some attributes of the server rendered HTML didn't
    match the client properties. **This won't be patched up.**" So unlike the
    badge bug it does *not* regenerate the tree — the DOM keeps `lang="hi"` and
    the end state is accidentally correct. The cost is a console error on every
    load for every Hindi user, which is the kind of noise that teaches people to
    ignore hydration errors.
    Fixed with `lang={DEFAULT_LANG}` plus `suppressHydrationWarning` on `<html>`
    — the divergence is intentional, and that is React's documented mechanism for
    exactly this case.
    **Verified independent of the badge fix:** with the badge bug temporarily
    restored, the structural mismatch still fires, so `suppressHydrationWarning`
    on `<html>` does not mask descendant mismatches. Measured by direct load
    before and after: `LANG=hi` → 1 error, now 0; `LANG=en` → 0 throughout.

12. **A shell-hydration guard, so this class is caught rather than hunted —
    the unit half is DONE, 2026-09-28 (L9 pass 3).**
    The shell is the only server-rendered surface (see the L7 → L3 note), and two
    mismatches were found there **by hand** — both by driving a real browser,
    neither by any of the ~500 tests, by typecheck, or by the build.
    `tests/hydration.test.tsx` now guards it in **CI** (jsdom, no browser, no dev
    server), which is better than the browser version this item originally asked
    for. It renders a component server-side, hydrates that markup against a
    populated store, and asserts React logs nothing.
    **What is left is the browser half**, and it is worth doing because the unit
    guard only covers components someone remembers to add: extend
    `app/scripts/smoke-routes.mjs` to do a **direct load** per route and fail on
    a hydration error. Its current soft-navigation *cannot* see one —
    client-side navigation never hydrates, so it can only ever report a mismatch
    on `/`. A `TARGET` + `MODE=direct|softnav` split is what made the difference
    here. That half stays browser-bound, so it inherits backlog 10's cost
    question rather than being CI-able.
    One trap worth recording, because it nearly produced a wrong result twice in
    this pass: **a scripted `str.replace` with no assertion fails silently.**
    Two mutation runs were reported before it was noticed that the first mutation
    was still in the file. Assert the mutation applied — or use an editor that
    errors on no-match — before trusting a green or red run.
