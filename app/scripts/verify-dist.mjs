/* Verifies the built PWA against docs/08-PWA-AND-TECH.md and AGENTS.md.
   Runs at the end of `npm run build`, and standalone with `npm run verify`. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cacheNames, swFilename, workboxOptions } from '../pwa.workbox.mjs'

/* TanStack Start writes the static PWA to dist/client (server bundle: dist/server). */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist', 'client')

const problems = []
const check = (condition, message) => {
  if (!condition) problems.push(message)
}
const read = (file) => {
  const path = join(dist, file)
  if (!existsSync(path)) {
    problems.push(`${file} is missing from the build`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function dirBytes(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).reduce((total, entry) => {
    const full = join(dir, entry)
    const stats = statSync(full)
    return total + (stats.isDirectory() ? dirBytes(full) : stats.size)
  }, 0)
}

/* 1. Shell (the phone's first paint) ---------------------------------- */
const html = read('index.html')
check(html.includes('manifest.webmanifest'), 'index.html does not link the manifest')
check(html.includes('#1F6B45'), 'index.html is missing the theme colour #1F6B45')
check(html.includes('viewport-fit=cover'), 'index.html is missing the phone viewport meta')
check(html.includes('apple-mobile-web-app-capable'), 'index.html is missing the iOS install meta')
check(html.includes('icons/icon-192.png'), 'index.html is missing the icon link')
check(html.includes('SeatSwap'), 'index.html is missing the wordmark')
check(html.includes('seatswap.easy.v1'), 'index.html is missing the easy-mode boot script')
/* Bottom tabs (AGENTS.md rule 12) must exist in the prerendered shell. */
for (const tab of ['href="/"', 'href="/swaps"', 'href="/profile"']) {
  check(html.includes(tab), `index.html is missing the ${tab} tab`)
}
const notFound = read('404.html')
check(notFound === html, '404.html must be a copy of the app shell (deep links on static hosts)')
check(existsSync(join(dist, '.nojekyll')), 'dist/client/.nojekyll is missing (GitHub Pages)')
check(existsSync(join(dist, '_redirects')), 'dist/client/_redirects is missing (Netlify/Surge rewrites)')

/* The Cloudflare upload is a staged copy WITHOUT `_redirects` — the platform
   rejects that file's Netlify catch-all as an infinite loop (see postbuild).
   A missing or wrong staging dir is an invisible failure until the next deploy
   is refused, so the deploy directory is checked here too. */
const cfDist = join(root, 'dist', 'cf')
check(existsSync(join(cfDist, 'index.html')), 'dist/cf/index.html is missing (run npm run build)')
check(!existsSync(join(cfDist, '_redirects')), 'dist/cf must NOT contain _redirects (Cloudflare rejects it)')
check(existsSync(join(cfDist, swFilename)), `dist/cf/${swFilename} is missing (offline needs the worker)`)
check(existsSync(join(cfDist, '_headers')), 'dist/cf/_headers is missing (Cloudflare reads it)')

/* 2. Manifest --------------------------------------------------------- */
const manifest = JSON.parse(read('manifest.webmanifest') || '{}')
check(manifest.name === 'SeatSwap', 'manifest name must be SeatSwap')
check(manifest.short_name === 'SeatSwap', 'manifest short_name must be SeatSwap')
check(manifest.display === 'standalone', 'manifest display must be standalone')
check(manifest.theme_color === '#1F6B45', 'manifest theme_color must be #1F6B45')
check(manifest.background_color === '#FAF6EE', 'manifest background_color must be #FAF6EE')
check(manifest.start_url === '/?source=pwa', 'manifest start_url must be / with the pwa source tag')
check(manifest.orientation === 'portrait', 'manifest orientation must be portrait')
check(
  Array.isArray(manifest.icons) && manifest.icons.length >= 3,
  'manifest needs 192/512/maskable icons',
)
check(
  (manifest.icons ?? []).some((icon) => String(icon.purpose ?? '').includes('maskable')),
  'manifest is missing a maskable icon',
)
check(manifest.id === '/', 'manifest id must be "/" (backlog 1: stable install identity)')
check(
  Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 1,
  'manifest needs launcher shortcuts (backlog 1)',
)
for (const shortcut of manifest.shortcuts ?? []) {
  check(
    typeof shortcut.url === 'string' && shortcut.url.startsWith('/'),
    `shortcut ${shortcut.name} must link an app route (leading /)`,
  )
  check(
    (shortcut.icons ?? []).every((icon) => existsSync(join(dist, String(icon.src).replace(/^\//, '')))),
    `shortcut ${shortcut.name} references a missing icon`,
  )
}

/* 3. Icons + fonts ---------------------------------------------------- */
for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png']) {
  check(existsSync(join(dist, icon)), `${icon} is missing from the build`)
}
const builtAssets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')) : []
check(
  builtAssets.some((file) => file.endsWith('.woff2')),
  'no woff2 font was emitted (Hindi needs Noto Sans Devanagari)',
)

/* 3b. Install-UI screenshots (docs/08) — declared by pwa.assets.mjs and
   generated by scripts/make-screenshots.mjs. Every entry must exist AND be
   exactly the size the manifest claims: a stale pwa.assets.mjs after a
   re-shoot, or a manifest entry whose PNG is missing, both break the install
   card silently, so the IHDR header is the source of truth. */
function pngDimensions(file) {
  const head = readFileSync(file).subarray(0, 24)
  return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`
}
check(
  Array.isArray(manifest.screenshots) && manifest.screenshots.length >= 1,
  'manifest needs at least one install screenshot (run node scripts/make-screenshots.mjs)',
)
for (const shot of manifest.screenshots ?? []) {
  const file = join(dist, String(shot.src).replace(/^\//, ''))
  check(existsSync(file), `${shot.src} is declared in the manifest but missing from the build`)
  if (existsSync(file)) {
    check(
      pngDimensions(file) === shot.sizes,
      `${shot.src} is ${pngDimensions(file)} but the manifest claims ${shot.sizes} — re-run make-screenshots`,
    )
  }
  check(shot.form_factor === 'narrow', `${shot.src} must be form_factor narrow (phone layout)`)
  check(typeof shot.label === 'string' && shot.label.length > 0, `${shot.src} needs a label`)
}

/* 4. Service worker (docs/08) ---------------------------------------- */
/* Strategies are checked on the shared options: the built worker is minified,
   so class names like NetworkFirst are not greppable in sw.js. */
const handlers = (workboxOptions.runtimeCaching ?? []).map((entry) => entry.handler)
check(handlers.includes('NetworkFirst'), 'pages must be NetworkFirst')
check(handlers.includes('CacheFirst'), 'hashed assets and fonts must be CacheFirst')
check(handlers.includes('NetworkOnly'), 'payments and live data must be NetworkOnly')
const globs = workboxOptions.globPatterns ?? []
check(
  globs.some((glob) => glob.includes('js') && glob.includes('css') && glob.includes('html')),
  'workbox globPatterns must cover the built js/css/html',
)
check(
  (workboxOptions.globIgnores ?? []).some((glob) => glob.includes(swFilename)),
  'the worker must not precache itself',
)
check(
  workboxOptions.navigateFallback === '/index.html',
  'the worker must fall back to the app shell for deep links',
)
check(
  (workboxOptions.navigateFallbackDenylist ?? []).length >= 2,
  'live endpoints must be excluded from the shell fallback',
)
check(workboxOptions.inlineWorkboxRuntime === true, 'the workbox runtime must be inlined')

const sw = read(swFilename)
check(sw.length > 0, `${swFilename} was not generated`)
check(sw.includes(`"${cacheNames.pages}"`), `pages cache must be named ${cacheNames.pages}`)
check(sw.includes(`"${cacheNames.assets}"`), `assets cache must be named ${cacheNames.assets}`)
check(sw.includes(`"${cacheNames.fonts}"`), `font cache must be named ${cacheNames.fonts}`)
check(sw.includes('"index.html"'), 'service worker must precache the app shell for offline deep links')
check(sw.includes('manifest.webmanifest'), 'service worker must precache the manifest')
check(sw.includes('razorpay') && sw.includes('paypal'), 'payment SDKs must be handled by the worker')
check(sw.includes('fallbackURL'), 'pages need a precached shell fallback for offline use')
check(!/url:"[^"]*woff2"/.test(sw), 'fonts must not be precached (they are cached on first use)')
check(!sw.includes('importScripts('), 'the workbox runtime must be inlined (no CDN fetch offline)')
check(!sw.includes('storage.googleapis.com'), 'the worker must not depend on a CDN')

/* 5. Weight (docs/07: first screen usable on a slow 3G phone) --------- */
const assetBytes = dirBytes(join(dist, 'assets'))
console.log(
  `[verify] shell html ${(html.length / 1024).toFixed(1)} KB · built assets ${(assetBytes / 1024).toFixed(1)} KB · worker ${(sw.length / 1024).toFixed(1)} KB`,
)
check(html.length < 40_000, 'the shell HTML looks too big for a slow-3G first paint')

if (problems.length > 0) {
  console.error('\n[verify] failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('[verify] PWA build looks correct: manifest, icons, worker and shell all in place.')
