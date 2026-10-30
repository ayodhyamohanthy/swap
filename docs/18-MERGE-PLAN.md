# 18 — Merge Plan (pile of 27 fo/* branches, as of 2026-10-30 11:00 IST)

Consolidated plan for landing the pending branch pile on top of main `002c2c2`.
Distilled from the Oct 28–30 hourly passes; every conflict below was measured
pairwise against main and within the pile, and every gate claim was run locally
(typecheck, 1046 tests `--maxWorkers=2`, build; see Verification).

## Base state

- main `002c2c2` is fully green: typecheck clean, 79 files / 1046 tests pass,
  build green, `npm audit --omit=dev` = 0 after the deps work below.
- Known FALSE red, not a repo defect: `tests/azure-burndown-dryrun.test.ts`
  fails 6 tests on node 22.14.0 unless `NODE_OPTIONS=--experimental-strip-types`
  is set (with it, 15/15 pass). Do not commit anything for it.

## Order

1. **PR #8 (`docs/instructions-v2`) first** — owner's own branch, open since
   Oct 15.
2. **Merge-clean singles**: `fo/swap-desc-refresh`, `fo/swap-gitignore-playwright`,
   `fo/swap-read-order-crossref`.
3. **Ledger-docs-only singles** (their only conflict is an appended
   DECISIONS/LANES line — keep BOTH lines): `fo/swap-canonical-link`,
   `fo/swap-csv-formula-guard`, `fo/swap-e2e-stale-guard`,
   `fo/swap-lane-board-archive`, `fo/swap-root-legacy-js`,
   `fo/swap-root-manifest-dangling`, `fo/swap-root-reprice-100`,
   `fo/swap-root-robots-sitemap`, `fo/swap-vendor-origin-guard`.
4. **Real-conflict singles**, one at a time, with the resolutions below.
5. **Dependencies: merge `fo/swap-deps-batch` (3e1fd74) INSTEAD OF the three
   singles `fo/swap-undici-pin`, `fo/swap-seroval-pin`, `fo/swap-zod-security`.**
   The batch is the verified union of all three (overrides block:
   fast-uri ^3.1.9, serialize-javascript ^7.1.4, source-map-js ^1.2.2,
   undici ^8.12.2, zod ^4.6.7; lock resolves undici 8.12.3, seroval 1.7.5,
   zod 4.6.7, fast-uri 3.1.9, serialize-javascript 7.1.4). It clears every
   prod+dev audit finding except deepmerge (no fixed release exists; dev-only,
   accepted). Discard the three singles after the batch lands.
6. **`fo/swap-backup-status`** (ce2cab2, docs-only note under the backup item in
   docs/10) can land anywhere; its docs/10 lines are in a different region from
   `fo/swap-dev-deps-audit` and `fo/swap-lane-map-unowned`, so merges resolve
   trivially.

## Real conflicts vs main (per branch)

| Branch | Files | Resolution |
| --- | --- | --- |
| admin-nul-byte | app/src/routes/admin.activity.tsx | take the branch (fixes the NUL-byte crash) |
| dev-deps-audit | app/locales/en.json + hi.json, docs/10, package.json | keep branch; if merged after deps-batch, union the package.json sections |
| error-screen | app/locales/en.json + hi.json | union both locale files' new keys with dev-deps-audit and tanstack-start-security |
| tanstack-start-security | app/locales/en.json + hi.json, docs/10, package.json | same as dev-deps-audit |
| e2e-pnr-flow | app/e2e/*, app/package.json, package-lock.json, playwright.config.ts | keep branch; regenerate the lock with `npm install` after merging qr-local/headers-csp |
| headers-csp | app/e2e/*, package files, playwright.config.ts, app/public/_headers | keep branch |
| headers-verifier | app/scripts/verify-dist.mjs | union with js-budget-guard's edits to the same script |
| js-budget-guard | app/scripts/verify-dist.mjs | same as headers-verifier |
| lane-map-unowned | docs/10, docs/13, docs/14 | keep branch (append-only ownership map) |
| qr-local | app/src/routes/share.$trainDate.tsx, package files | keep branch |

## Branch-vs-branch within the pile (7 real pairs of 253)

- canonical-link x error-screen: `app/src/routes/__root.tsx` — keep BOTH changes:
  error-screen's `errorComponent`/`notFoundComponent` lines AND canonical-link's
  `head: ({ matches }) =>` signature. Taking error-screen's `head: () =>` verbatim
  breaks the per-route canonical (the body reads `matches`), the typecheck, and
  the build's prerendered head. Verified below.
- dev-deps-audit x zod-security: `package.json` — moot after deps-batch; if the
  singles are used instead, keep both dep sets and regenerate the lock.
- e2e-pnr-flow x gitignore-playwright, and gitignore-playwright x headers-csp:
  `.gitignore` — take gitignore-playwright's version (most complete), the other
  two drop their added lines.
- e2e-pnr-flow x qr-local, and headers-csp x qr-local: `package.json` + lock —
  keep both, regenerate the lock with `npm install`.
- root-legacy-js x root-reprice-100: delete-vs-modify on `js/accept.js` — take
  the deletion.
- All other 36 conflicting pairs are ledger-docs-only (two appended lines on
  DECISIONS.md / docs/14): keep both.

## Verification

- Typecheck: `npm run typecheck` — clean on main and on every branch above.
- Tests: `npm run test -- --maxWorkers=2` — 79 files / 1046 tests, on node
  22.20.0 unflagged (or 22.14 with the NODE_OPTIONS flag above).
- Build: `npm run build` — green, PWA verify passes.
- Prod audit after deps-batch: `npm audit --omit=dev` — 0 vulnerabilities.
- CI note: green.yml does not run on fo/* branch pushes, so local gates are the
  only verification until merge.

## Docs numbering note

docs/ currently has duplicate numbers (15-AUDIT/15-NAMING, 16-BEST-PRACTICES/
16-EXIT-PLAYBOOK, 17-MOBILE-FIRST/17-PRODUCTION-PATH). This file takes 18 as
the next free number; renumbering is deferred so it cannot conflict with the
pile. Worth a dedicated pass once the pile lands.

## Sequence check (2026-10-30 13:00 IST)

The full order above was simulated from `002c2c2` in a scratch clone, merging
one branch at a time in the listed order. Result: all 26 non-conflicted
branches land clean in sequence (phase A: 3/3, phase B: 10/11, phase C: 8/11
attempts), and the only conflicts that surfaced are exactly the documented
ones: `js/accept.js` delete-vs-modify (root-legacy-js before root-reprice-100),
`app/src/routes/__root.tsx` (canonical-link before error-screen), and
`.gitignore` twice (gitignore-playwright before e2e-pnr-flow and headers-csp).
No new conflict pairs appeared beyond the pairwise map. The simulation resolved
the appended docs and locale files with union merge; the package.json/lock
groups still need the documented lock regeneration with `npm install`.

## PR #8 conflict surface (measured 2026-10-30 16:00 IST)

`docs/instructions-v2` (head d695c53) does NOT merge cleanly onto main
`002c2c2`: a direct merge attempt conflicts on 20 files —
.github/workflows/seatswap-backup.yml, app/scripts/collab-check.mjs,
app/scripts/lane-board.{mjs,d.mts}, app/src/lib/{admin,store,utils}.ts,
app/src/routes/{admin.payments,pay.$requestId.method,profile.payments.$id,
profile.settings}.tsx, app/src/styles.css, app/tests/{admin,collab-check,
groups,qa-protocol,rule6-paid,schema}.test.ts, docs/06-PAYMENTS.md, and
package-lock.json. The branch predates the Razorpay-primary landing (86d2c78)
and the lane-board/collab-check changes, so its stale copies collide with what
main already shipped. Resolution is the owner's call (it is their branch):
rebase/refresh PR #8 onto current main before landing, or land the fo/* pile
first (its sequence from 002c2c2 is verified below) and rebase PR #8 on top —
either way the conflicts above must be resolved by hand, keeping main's
landed payments and lane-board state.

Re-run of the pile sequence with PR #8 removed reproduced the 13:00 IST
result exactly: everything lands clean except the three documented
conflicts (js/accept.js, __root.tsx, .gitignore x2).

## What each branch contains (commit subjects, 2026-10-30 17:00 IST)

**Merge-clean singles.** `desc-refresh`: refresh the stale package
description. `gitignore-playwright`: ignore Playwright's app/test-results run
artefacts. `read-order-crossref`: add the docs/17 W8.2 standards-chain read
order to agents.md and README.

**Ledger-docs-only singles.** `canonical-link`: self-canonicalize every page
onto the apex origin (shell). `csv-formula-guard`: neutralise CSV formula
injection in exports (L7). `e2e-stale-guard`: mark the legacy root E2E suites
as guarded instead of failing like regressions. `lane-board-archive`: archive
lane prose, resolved requests and backlog text off the board (W8.1).
`root-legacy-js`: drop 15 unreferenced prototype scripts from the root legacy
surface + decision record. `root-manifest-dangling`: restore the root manifest
the #10 fold removed while it was still consumed + decision record.
`root-reprice-100`: reprice the root Steps 1-2 PWA to the Oct 21 rupee-100
ruling, carrying the manifest restore (root suite 22/22).
`root-robots-sitemap`: ship root robots.txt + sitemap.xml and correct the
decision row (toyoufromme.website serves the app).
`vendor-origin-guard`: check every external origin in src against the docs/12
vendor ledger (L9).

**Real-conflict singles.** `admin-nul-byte`: remove a stray NUL byte from
admin.activity.tsx and guard src against control characters.
`dev-deps-audit`: bump vite to 7.3.7 and vitest to 4.1.12 for security
advisories. `error-screen`: branded, translated root error screen with retry
(L1). `tanstack-start-security`: bump @tanstack/react-start to 1.168.60
(GHSA-qx66-fv34-fjm8). `e2e-pnr-flow`: Playwright e2e for the PNR flow (sign-in
gate, axe scans, offline summaries, docs/17 W6.1). `headers-csp`: ship the real
CSP with parse5-derived inline-script hashes (W7), built on e2e-pnr-flow.
`headers-verifier`: assert every security and cache claim the _headers file
makes (W7). `js-budget-guard`: enforce the 200KB initial-JS budget in
verify-dist (W6). `lane-map-unowned`: complete the docs/13 ownership map,
seven unowned surfaces (L9). `qr-local`: draw the invite QR on-device instead
of a QR image vendor (L3).

**Dependencies.** `deps-batch`: undici ^8.12.2 override + seroval 1.7.5 +
zod ^4.6.7 with transitive fast-uri ^3.1.9 and serialize-javascript ^7.1.4
(supersedes undici-pin, seroval-pin, zod-security).
**Docs.** `backup-status`: outage note under the docs/10 backup item.
`merge-plan` (this branch): the plan you are reading.

## End-state verification (2026-10-30, gates run on the merged result)

The whole pile was merged in a scratch clone following this plan (js/accept.js
deletion applied, .gitignore taken from gitignore-playwright, locale unions,
both devDependency additions kept per conflict, lock regenerated with
`npm install --package-lock-only` + `npm ci`). Three failures surfaced that no
textual diff shows, all consequences of qr-local landing; apply these after the
pile merges:

1. `app/tests/vendor-origins.test.ts` — delete the `api.qrserver.com`
   pending-gap entry. The guard's own comment says check 2 fires the moment
   qr-local merges; it fired, and deleting the entry makes the guard prove the
   vendor is gone rather than trusting it.
2. `app/e2e/csp.spec.ts` — drop the `expect(csp).toContain('api.qrserver.com')`
   line; the vendor no longer appears in src.
3. `app/public/_headers` — drop `https://api.qrserver.com` from `img-src`
   (stale after qr-local; the dist copies regenerate on build).

With those three plus the exact __root.tsx merge above, the end state passes
every gate on node 22.20 unflagged: typecheck clean, 84 files / 1064 tests,
build green (initial JS 189.5 KB gzip of the 200 KB budget, PWA
manifest/icons/worker verified). The merge session can proceed with these
resolutions in hand.
