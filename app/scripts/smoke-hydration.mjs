/* Direct-load every route and fail on any console error.
 *
 * WHAT THIS ANSWERS THAT smoke-routes.mjs CANNOT
 *
 *   `smoke-routes.mjs` walks the routes with pushState on ONE page. Client-side
 *   navigation never hydrates, so it can never report a hydration mismatch —
 *   the initial `/` load is the only hydration it performs. This script opens a
 *   FRESH PAGE per route and does a real `page.goto`, which is the only way a
 *   deep link's server render and hydrate can be compared. That is what both
 *   hydration bugs found on 2026-09-28 needed: a badge rendered from live store
 *   state instead of the snapshot, and a prerendered `<html lang>` that
 *   disagreed with the client's. Neither was visible to a soft-navigating probe
 *   (`navErrors: 0` in every run) and neither broke a single test.
 *
 *   The two scripts are complements. This one asks "does a real load of each
 *   route stay quiet?"; that one asks "does each route render something?".
 *
 * BASELINE (2026-09-28, all 53 routes, vite dev): 0 console errors, 0 hydration
 * errors. Any non-zero count here is a regression.
 *
 * PREREQUISITES
 *   - a dev server:  npm run dev --workspace seatswap-app -- \
 *                      --port 5199 --host 127.0.0.1 --strictPort
 *     (`vite dev` otherwise listens on [::1] only, so bind IPv4 explicitly)
 *   - a Chrome/Chromium binary (auto-detected, or set CHROME=...)
 *   - `puppeteer-core`, deliberately NOT a project dependency:
 *         npm install puppeteer-core
 *
 * USAGE
 *   node app/scripts/smoke-hydration.mjs
 *   BASE=http://127.0.0.1:5199 node app/scripts/smoke-hydration.mjs
 *   VERBOSE=1 node app/scripts/smoke-hydration.mjs     # every route's text len
 *   WAIT=2000 node app/scripts/smoke-hydration.mjs     # slower machine
 *
 * Exits 0 when every route loads with no console error, 1 otherwise. */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const routesDir = join(root, 'src', 'routes')
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const VERBOSE = process.env.VERBOSE === '1'
/* Per-route settle time. The dev server transforms modules on demand, so a
   cold route can take a moment; a too-short wait reports a blank screen that is
   really just an unfinished load. */
const WAIT = Number(process.env.WAIT || 1200)

/* Below this many characters of visible text a route has not really rendered,
   so its "0 errors" is vacuous — there was nothing to mismatch. Reported
   alongside the count so the two can never be read apart. */
const THIN_TEXT_LENGTH = 120

/* Placeholder values for `$param` segments, matching smoke-routes.mjs. Screens
   that need a real row render their empty state; the question here is whether a
   real load of the route is quiet, not whether the fixture is rich. */
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

/**
 * Seed the device BEFORE the app boots.
 *
 * `evaluateOnNewDocument` rather than seeding after load: the store reads
 * localStorage once at module scope and caches the snapshot, so anything
 * written after the first paint is invisible to it.
 *
 * `seen` matters as much as the data. Without it `routes/index.tsx` throws a
 * redirect to `/welcome/language` and then `/welcome/note`, so `/` — and
 * anything behind the same guard — renders an onboarding screen instead of the
 * screen under test. Its "0 console errors" would then be true of the wrong
 * page, which is the most expensive kind of green.
 *
 * `seatswap.lang.v1` is a RAW string, not JSON: index.html's inline script
 * compares it directly with 'hi'.
 */
function seedDevice() {
  const now = Date.now()
  const iso = (ms) => new Date(ms).toISOString()
  localStorage.setItem('seatswap.lang.v1', 'en')
  localStorage.setItem('seatswap.seen.v1', JSON.stringify({
    language: true, note: true, alerts: true, signin_asked: true,
  }))
  /* A wallet with an expired earn, a live earn and a spend, so the credit
     screens have a shape worth hydrating. */
  localStorage.setItem('seatswap.wallet.v1', JSON.stringify([
    { id: 'w1', user_id: null, amount_paise: 9900, kind: 'swap_to_credit',
      ref_request_id: null, expires_at: iso(now - 86400000), created_at: iso(now - 400 * 86400000) },
    { id: 'w2', user_id: null, amount_paise: 5000, kind: 'acceptor_credit',
      ref_request_id: null, expires_at: iso(now + 300 * 86400000), created_at: iso(now - 86400000) },
    { id: 'w3', user_id: null, amount_paise: -4900, kind: 'used',
      ref_request_id: 'req_1', expires_at: null, created_at: iso(now - 86400000) },
  ]))
  for (const key of [
    'seatswap.activity.v1',
    'seatswap.trips.v1',
    'seatswap.payments.v1',
    'seatswap.confirmations.v1',
    'seatswap.ratings.v1',
    'seatswap.groups.v1',
    'seatswap.invites.v1',
    'seatswap.requests.v1',
    'seatswap.outbox.v1',
  ]) {
    localStorage.setItem(key, JSON.stringify([]))
  }
}

/**
 * Poll until the server actually answers 200.
 *
 * vite printing `ready in N ms` is NOT readiness — the first request still
 * triggers a full transform, and a 5s timeout reports 000 while the server is
 * perfectly healthy.
 *
 * The failure this prevents is the expensive one. Against a dead server, `goto`
 * lands on Chrome's own "This site can't be reached" page, which has an OPAQUE
 * origin: `localStorage` then throws SecurityError, the store cannot boot, and
 * EVERY route reports an identical error with an identical ~162-character body.
 * That reads exactly like a catastrophic app-wide defect and is purely an
 * artefact of the harness. Identical failure on every route means the harness,
 * not the app.
 */
async function waitForServer(base, timeoutMs = 90000) {
  const started = Date.now()
  let last = 'no attempt'
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (error) {
      last = String(error).slice(0, 80)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  console.error(
    `Server at ${base} never answered 200 within ${timeoutMs}ms (last: ${last}).\n` +
      'Start it with: npm run dev --workspace seatswap-app -- --port 5199 --host 127.0.0.1 --strictPort',
  )
  process.exit(1)
}

const routes = ['/', ...[...new Set(
  readdirSync(routesDir).filter((name) => name.endsWith('.tsx')).map(toUrl).filter(Boolean),
)].sort()]

await waitForServer(BASE)

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  /* `--no-proxy-server` is required on a machine that exports HTTP_PROXY
     (curl needs `--noproxy '*'` for the same reason). Chrome inherits it and
     sends loopback requests to the proxy, which answers with an error page —
     an opaque origin again, with the same misleading all-routes-fail shape. */
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
})

const results = []
for (const path of routes) {
  /* A FRESH PAGE PER ROUTE. Reusing one page pools every route's errors into a
     single array, which makes "route X caused this error" unanswerable — the
     mistake that made an earlier probe's output useless. */
  const page = await browser.newPage()
  await page.setViewport({ width: 1180, height: 1000, deviceScaleFactor: 1 })
  const bucket = []
  page.on('console', (message) => {
    if (message.type() === 'error') bucket.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('pageerror', (error) => bucket.push(`throw: ${String(error).slice(0, 200)}`))
  await page.evaluateOnNewDocument(seedDevice)

  let landed = path
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 30000 })
  } catch (error) {
    bucket.push(`goto: ${String(error).slice(0, 160)}`)
  }
  await new Promise((resolve) => setTimeout(resolve, WAIT))

  const probe = await page
    .evaluate(() => {
      const main = document.querySelector('main')
      const text = main ? main.innerText.replace(/\s+/g, ' ').trim() : ''
      return { pathname: location.pathname, textLen: text.length, head: text.slice(0, 90) }
    })
    .catch(() => ({ pathname: '?', textLen: -1, head: '' }))

  /* The dev-only manifest 404 is not this app's error — the manifest is a build
     artefact. Counted and reported separately rather than dropped, so it cannot
     silently grow into a real failure being ignored. */
  const manifest = bucket.filter((m) => /manifest|404 \(\)/.test(m))
  const real = bucket.filter((m) => !/manifest|404 \(\)/.test(m))
  const hydration = real.filter((m) => /hydrat|#418|#423|#425|did not match/i.test(m))

  results.push({
    requested: path,
    ...probe,
    manifest: manifest.length,
    hydration,
    errors: [...new Set(real)],
  })
  landed = probe.pathname
  await page.close()
}

await browser.close()

const noisy = results.filter((row) => row.errors.length)
const hydrating = results.filter((row) => row.hydration.length)
const thin = results.filter((row) => row.textLen >= 0 && row.textLen < THIN_TEXT_LENGTH)

console.log(`routes direct-loaded: ${results.length}`)
console.log(`routes with console errors: ${noisy.length}`)
console.log(`routes with a hydration error: ${hydrating.length}`)
console.log(`routes that rendered almost nothing: ${thin.length}`)

if (noisy.length > 0) {
  console.log('\n=== ERRORS (a real load of each route) ===')
  for (const row of noisy) {
    console.log(`  ${row.requested}  ->  ${row.pathname}`)
    for (const message of row.errors.slice(0, 4)) console.log(`      ${message}`)
  }
}
if (thin.length > 0) {
  console.log('\n=== RENDERED ALMOST NOTHING (their 0 errors is vacuous) ===')
  for (const row of thin) {
    console.log(`  ${row.requested}  ->  ${row.pathname}  text=${row.textLen}  "${row.head.slice(0, 40)}"`)
  }
}
if (VERBOSE) {
  console.log('\n=== ALL ROUTES (thin -> thick) ===')
  for (const row of [...results].sort((a, b) => a.textLen - b.textLen)) {
    console.log(`  ${String(row.textLen).padStart(5)}  ${row.requested.padEnd(30)} ${row.pathname.padEnd(30)} ${row.head.slice(0, 44)}`)
  }
}

process.exit(noisy.length > 0 ? 1 : 0)
