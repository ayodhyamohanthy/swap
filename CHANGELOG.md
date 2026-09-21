# Changelog

All notable changes to SwapSeat are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project is not yet
semver-tagged, so entries are grouped by release date.

## [Unreleased] — mobile-first PWA hardening

### Added

* **Swap ledger** (`js/ledger.js`) — a versioned, device-local record of every
  attempted and completed swap. Schema v1 with `createdAt`, `updatedAt`, `mode`,
  `serviceNumber`, `travelDate`, `coachOrCabin`, `ownSeat`, `targetSeat`,
  `status`, `failureReason`, `quoteSummary` and an idempotency key, plus a
  migration path from the earlier unversioned request/listing stores.
* **History screen** (`js/history.js`) — reviewable ledger with timestamp,
  service, seats and status, re-open/retry for pending or failed rows, clipboard
  copy, JSON export, and **Erase all local data** (the sign-out path for shared
  devices).
* **Explicit failure states** (`js/states.js`) — dedicated screens for offline,
  failure/timeout, stale quote, rejected confirmation and unsupported browser,
  each with a retry or fallback action.
* **PWA runtime** (`js/pwa.js`) — service-worker registration with an
  “Update ready — reload” handshake, in-app install prompt, iOS
  add-to-home-screen hint, aria-live network banner with the last-sync time, and
  in-progress form draft persistence that excludes sensitive fields.
* **Offline document** (`offline.html`) — self-contained fallback served by the
  service worker when a navigation is neither cached nor reachable.
* **PWA regression tests** (`tests/pwa.test.js`, `tests/ledger.test.js`) and a
  single entry point, `tests/run-all.sh`.
* **Docs** — `docs/PWA.md` (storage schema, caching policy and never-cache list,
  environment variables, deploy steps, rollback including cache purging).

### Changed

* **Mobile-first layout**: interactive controls raised to a 44x44 CSS px minimum
  (seat buttons were 34x34), wide seat rows scroll inside their own container
  instead of widening the page, safe-area insets applied to the flow header and
  tab bar, and the legacy/flow class collisions (`.seat`, `.rno`, `.frow`) are
  now scoped so `?legacy=1` keeps its original geometry.
* **Accessibility**: focus moves to the new screen on every route change with the
  title announced through a polite live region; the toast is a `role="status"`
  live region; small-text contrast tokens darkened to clear WCAG AA
  (`--dim` 4.48:1 → 6.9:1, `--ok` 3.94:1 → 5.4:1, `--warn` 4.46:1 → 6.4:1).
* **Service worker**: navigation-aware, cache-first shell with an explicit
  offline document; per-asset precache that no longer aborts the whole install on
  a single 404; extended never-cache list covering checkout SDKs and backend
  paths; cache name bumped to `swapseat-v3.0.0`.
* **Manifest**: added `id` and `display_override`; `theme_color` /
  `background_color` aligned with the page so the splash and status bar no longer
  disagree.
* **Icons**: `maskable-512.png` is now a real maskable asset (full-bleed
  background with the artwork inside the 80% safe circle) instead of a byte copy
  of `icon-512.png`.
* **Payments**: backend calls are bounded with a 12s abort and a gateway failure
  now routes to a visible failure state instead of a transient toast.
* **Fee gate fix**: the accepter's “Option A · Confirm Acceptance” button was
  `aria-disabled` only and its handler ignored the policy decision, so a swap
  could be confirmed through the option that did not apply. It is now really
  `disabled` and the handler re-checks the policy rule.
* **README** — run/test instructions match reality, including the pre-existing
  need to point the classic-engine browser suites at `?legacy=1`.
* `tests/e2e-v2.js` — two ambiguous `.mode-tabs` selectors scoped to
  `#classicShell` so the suite is deterministic now that two shells exist
  (assertions unchanged).

### Changed

* **First-paint optimisation**: the home screen is prerendered in `index.html`
  and boot wires it in place instead of repainting (guarded by a drift check in
  `tests/mobile-audit.js` that fails when the static markup and `render()`
  diverge); the classic shell's marketplace/inbox/admin renders are scheduled
  after first paint. Observed LCP on the unthrottled trace: **178 ms**; measured
  with Lighthouse's own CDP throttling applied to a real browser: **852 ms**.
  (Lighthouse's Lantern simulation still reports ~3.0 s because its network
  model serialises the 17 zero-build scripts before allowing the paint; the
  observed metrics and the trace are archived with this release.)

### Fixed

* `Bookings.remember()` shadowed its own `refs()` accessor (`const refs =
  refs()`), throwing "Cannot access 'refs' before initialization" — the PNR
  lookup path never advanced past the form. A pre-existing defect on `main`,
  found by the new states audit.
* Offline acceptance/payment can no longer be registered as confirmed.
* The seat-selection step reports a missing selection inline (`role="alert"`)
  instead of relying on a transient toast.

### Known issues

* The three browser suites still exercise the classic engine rather than the
  mobile flow; there is no automated test that drives the flow screens end to
  end, and none that exercises the install prompt.
* Real-device (iOS Safari / Android Chrome) verification is documented as an
  emulation matrix; the install-to-home-screen step is not automated.
