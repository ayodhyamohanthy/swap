/* Route smoke test — walks every route in a real browser and reports the two
   things no other check in this repo can see:

     1. a route that renders nothing (a blank screen), and
     2. a route that throws or logs a console error.

   WHY THIS EXISTS. `typecheck`, `npm run test` and `npm run build` all passed
   while `routes/admin._index.tsx` declared `createFileRoute('/admin/_index')` —
   a leading underscore is TanStack's marker for a *pathless* route, so it
   generated `path: ''` and `/admin` matched the layout with an empty
   <Outlet/>. The whole design-23 Overview screen was unreachable and nothing
   in the toolchain noticed. See docs/14-LANES.md, L7 pass 7.

   TWO MODES (backlog 12). `MODE=softnav` (default) is the original probe:
   load once, then soft-navigate — the way a user moves between tabs. A soft
   navigation never hydrates, so it can never see a hydration error.
   `MODE=direct` full-loads every route URL instead. Only the shell is
   server-rendered (see the L7 → L3 note in docs/14-LANES.md) and it hydrates
   on every full load, so direct mode re-runs the app's one hydration against
   the markup the dev server just SSR'd, and fails on the first mismatch.
   React reports both known variants on console.error ("A tree hydrated but
   some attributes ...", "Hydration failed because ...") — the same channel
   `tests/hydration.test.tsx` reads in CI; this is the browser half of that
   guard. `TARGET=<route>` probes a single route in either mode.

   WHAT THIS DOES *NOT* CATCH — read this before trusting a green run.
   That bug rendered the entire admin sidebar, so the page had plenty of text.
   A "renders nothing" check cannot see it. The pathless-route class is covered
   by the unit assertions in `tests/routes.test.ts` (no declared id containing
   `_index`; every index route ends in `/`; no `path: ''` in the generated
   tree). This script covers a different class: runtime breakage and truly
   blank screens. They are complements, not substitutes.

   PREREQUISITES
     - a dev server:  npm run dev --workspace seatswap-app -- \
                        --port 5199 --host 127.0.0.1 --strictPort
       (bind IPv4 explicitly; `vite dev` otherwise listens on [::1] only)
     - a Chrome/Chromium binary (auto-detected, or set CHROME=...)
     - `puppeteer-core`, which is deliberately NOT a project dependency — it is
       a verification tool, not a build input, and adding it would churn the
       lockfile for every lane. Install it where you like:
           npm install puppeteer-core
       If it cannot be resolved the script says so and exits 1.

   USAGE
     node app/scripts/smoke-routes.mjs                          # softnav (default)
     MODE=direct node app/scripts/smoke-routes.mjs              # full-load each route
     TARGET=/ node app/scripts/smoke-routes.mjs                  # one route, either mode
     BASE=http://127.0.0.1:5199 node app/scripts/smoke-routes.mjs
     VERBOSE=1 node app/scripts/smoke-routes.mjs      # print all 58 rows

   Exits 0 when every route rendered and nothing threw, 1 otherwise. */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const routesDir = join(root, 'src', 'routes')
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const VERBOSE = process.env.VERBOSE === '1'

/* softnav: the original probe (one load, client-side navigation, no
   hydration). direct: a full document load per route, which is the only way a
   browser ever sees a hydration error — see the header. */
const MODE = (process.env.MODE || 'softnav').toLowerCase()
if (MODE !== 'softnav' && MODE !== 'direct') {
  console.error(`MODE must be 'softnav' or 'direct', got '${MODE}'`)
  process.exit(1)
}
/* One route URL exactly as the probe would generate it (e.g. TARGET=/swaps).
   Empty means "every route". */
const TARGET = process.env.TARGET || ''

/* React reports hydration failures on console.error in messages that always
   carry the stem "hydrat" ("A tree hydrated but some attributes ... didn't
   match", "Hydration failed because ..."). Direct mode highlights these;
   softnav can never produce one. */
const HYDRATION_ERROR = /hydrat/i

/* A screen is "blank" below this many characters of visible text. Every real
   screen in this app renders at least a heading, and an empty-state screen
   renders a heading plus a sentence, so the floor is generous rather than
   tight. */
const BLANK_TEXT_LENGTH = 12

/* Placeholder values for `$param` segments. Screens that need a real row will
   render their empty state instead, which is fine: the question is whether the
   route matches and its component renders, not whether the fixture is rich. */
const PARAM = {
  id: 'x_1',
  tripId: 'x_trip',
  requestId: 'x_req',
  number: '12951',
  code: 'ABC123',
  trainDate: '12951-2026-09-28',
}

/** `admin._index.tsx` is not a page (pathless); `admin.index.tsx` is /admin. */
function toUrl(file) {
  const base = file.replace(/\.tsx$/, '')
  if (base === '__root') return null
  const parts = base.split('.').filter((segment) => segment !== 'index')
  if (parts.length === 0) return '/'
  return (
    '/' +
    parts
      .map((segment) =>
        segment.startsWith('$') ? (PARAM[segment.slice(1)] ?? `x_${segment.slice(1)}`) : segment,
      )
      .join('/')
  )
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    console.error(
      'No Chrome/Chromium found. Set CHROME=/path/to/chrome, or install one.\n' +
        'Checked:\n  ' +
        candidates.join('\n  '),
    )
    process.exit(1)
  }
  return found
}

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error(
    '`puppeteer-core` is not installed.\n' +
      'It is intentionally not a project dependency — install it wherever you like:\n' +
      '    npm install puppeteer-core\n',
  )
  process.exit(1)
}

/* Kept as a list WITH duplicates (two files can probe the same URL, e.g. an
   index and its sibling) — the historical count is "58 routes probed" and the
   duplication is harmless: a URL worth probing once is worth probing twice. */
const routes = readdirSync(routesDir)
  .filter((name) => name.endsWith('.tsx'))
  .map(toUrl)
  .filter(Boolean)
  .sort()

if (TARGET && !routes.includes(TARGET)) {
  console.error(`TARGET '${TARGET}' is not one of the ${routes.length} route URLs the probe generates.`)
  console.error(`Routes start: ${routes.slice(0, 5).join(' ')} ...`)
  process.exit(1)
}
const probeRoutes = TARGET ? [TARGET] : routes

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
/* Phone viewport: SeatSwap is mobile-first, so this is the shape the design
   images and the tab bar are built for. */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

/* Dev noise, but ONLY in direct mode and ONLY for the manifest, identified by
   URL rather than blanket: `vite-plugin-pwa` deliberately does not serve the
   manifest when `devOptions.enabled` is false (docs/08), so every fresh
   document load fetches /manifest.webmanifest and gets a 404 — Chrome then
   logs both a resource failure and an installability complaint. Chrome puts
   the failing URL in `message.location().url` on the resource failure and
   spells the URL out in the installability text; any other resource 404 has
   a different URL and still fails the route. Softnav keeps the original
   strict behaviour: it does not reload, so it never sees this pair. */
function isManifestNoise(message) {
  const text = message.text()
  const url = message.location()?.url ?? ''
  if (url.endsWith('/manifest.webmanifest')) return /^Failed to load resource/.test(text)
  return /^Manifest fetch from .*\/manifest\.webmanifest failed/.test(text)
}

let bucket = []
page.on('console', (message) => {
  if (message.type() !== 'error') return
  if (MODE === 'direct' && isManifestNoise(message)) return
  bucket.push(`console: ${message.text().slice(0, 160)}`)
})
page.on('pageerror', (error) => bucket.push(`throw: ${String(error).slice(0, 160)}`))

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
} catch (error) {
  console.error(`Could not reach ${BASE}. Is the dev server running?\n${String(error)}`)
  await browser.close()
  process.exit(1)
}

/* Seed, then reload. Two details that matter:
   - the store reads localStorage ONCE at boot and caches the snapshot, so
     seeding after load is invisible to it;
   - `seatswap.lang.v1` is a RAW string, not JSON — index.html's inline script
     compares it directly with 'hi'. */
await page.evaluate(() => {
  const now = new Date()
  const at = (hour) => {
    const d = new Date(now)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  let n = 0
  const row = (action, meta, created_at) => ({
    id: `smoke_${++n}`,
    actor_id: null,
    actor_role: 'user',
    action,
    entity: null,
    entity_id: null,
    meta,
    created_at,
  })

  localStorage.setItem('seatswap.lang.v1', 'en')
  localStorage.setItem(
    'seatswap.activity.v1',
    JSON.stringify([
      row('pnr_added', { train_no: '12951', class: '3A' }, at(9)),
      row('swap_confirmed', {}, at(10)),
      row('matches_viewed', { matches: 0, capped: false }, at(11)),
    ]),
  )
  for (const key of [
    'seatswap.trips.v1',
    'seatswap.wallet.v1',
    'seatswap.payments.v1',
    'seatswap.confirmations.v1',
    'seatswap.ratings.v1',
    'seatswap.seen.v1',
    'seatswap.groups.v1',
    'seatswap.invites.v1',
    'seatswap.outbox.v1',
  ]) {
    localStorage.setItem(key, JSON.stringify([]))
  }
  /* One accepted incoming response. `updatesFrom()` turns it into one unread
     update, so the Swaps-tab badge is live during the probe — the conditional
     shell content that the shipped hydration bug lived behind. Without a row
     the badge never renders and no hydration check can ever see that branch.
     `incoming` is an object, not an array — the other keys above are arrays. */
  localStorage.setItem(
    'seatswap.requests.v1',
    JSON.stringify({ requests: [], offers: [], incoming: { x_1: 'accepted' } }),
  )
})
await page.reload({ waitUntil: 'networkidle2' })

const results = []
for (const path of probeRoutes) {
  bucket = []
  if (MODE === 'direct') {
    /* Full document load: the server renders the shell fresh for this URL and
       React hydrates against it. `load` (not `networkidle2`) because a dev
       server keeps the HMR socket open forever; the settle after it is when
       hydration + the router's first render happen. */
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 20_000 })
    } catch (error) {
      bucket.push(`goto: ${String(error).slice(0, 160)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  } else {
    await page.evaluate((target) => {
      /* Soft navigation. `page.goto` on a client-rendered route serves the
         prerendered home page (only `/` is prerendered) and throws React #418;
         pushState alone fires no event, so the popstate is what makes the
         router re-read location. */
      history.pushState(null, '', target)
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    }, path)
    await new Promise((resolve) => setTimeout(resolve, 380))
  }

  const probe = await page.evaluate(() => {
    const main = document.querySelector('main')
    const text = main ? main.innerText.replace(/\s+/g, ' ').trim() : ''
    return { pathname: location.pathname, textLen: text.length, head: text.slice(0, 90) }
  })
  results.push({ requested: path, ...probe, errors: [...new Set(bucket)] })
}

await browser.close()

const blank = results.filter((row) => row.textLen < BLANK_TEXT_LENGTH)
const noisy = results.filter((row) => row.errors.length)

console.log(`mode: ${MODE}${TARGET ? ` (target ${TARGET})` : ''}`)
console.log(`routes probed: ${results.length}`)
console.log(`blank screens: ${blank.length}`)
console.log(`routes with errors: ${noisy.length}`)
console.log(`hydration errors: ${noisy.reduce((n, row) => n + row.errors.filter((m) => HYDRATION_ERROR.test(m)).length, 0)}`)

if (blank.length > 0) {
  console.log('\n=== RENDERED NOTHING ===')
  for (const row of blank) console.log(`  ${row.requested}  ->  ${row.pathname}`)
}
if (noisy.length > 0) {
  console.log('\n=== ERRORS ===')
  for (const row of noisy) {
    console.log(`  ${row.requested}`)
    for (const message of row.errors.slice(0, 3))
      console.log(`      ${HYDRATION_ERROR.test(message) ? '[hydration] ' : ''}${message}`)
  }
}
if (VERBOSE) {
  console.log('\n=== ALL ROUTES (thin -> thick) ===')
  for (const row of [...results].sort((a, b) => a.textLen - b.textLen)) {
    console.log(`  ${String(row.textLen).padStart(5)}  ${row.requested.padEnd(34)} ${row.head.slice(0, 52)}`)
  }
}

process.exit(blank.length > 0 || noisy.length > 0 ? 1 : 0)
