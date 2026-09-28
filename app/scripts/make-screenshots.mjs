/* SeatSwap PWA store screenshots — real Chrome, real build, no paid asset tool.

   Builds nothing itself: run `npm run build` first. Serves dist/ over a tiny
   local static server (SPA fallback), then captures real screens with headless
   Chrome at a phone viewport and writes app/public/screenshots/*.png.

   Run: node app/scripts/make-screenshots.mjs
   Then wire the output into the manifest (vite.config.ts -> manifest.screenshots).
   Chrome path is auto-detected; override with CHROME=/path/to/chrome. */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* The static host serves dist/client (that is also wrangler.toml's assets dir),
   so that is what we screenshot. */
const DIST = join(ROOT, 'dist', 'client')
const OUT = join(ROOT, 'public', 'screenshots')

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

/* narrow = the phone layout the Play Store and iOS install UI expect.
   Routes chosen from docs/05: first-run language pick, then the core action. */
const SHOTS = [
  {
    route: '/welcome/language',
    name: 'narrow-language.png',
    label: 'Pick your language',
  },
  {
    route: '/trips/add',
    name: 'narrow-trips-add.png',
    label: 'Add your PNR and find a swap',
  },
]

function chrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('No Chrome/Chromium found — set CHROME=/path/to/chrome')
}

function serve(dir) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = resolve(dir, '.' + (url === '/' ? '/index.html' : url))
    // SPA fallback: anything without an extension (or a miss) is the shell.
    if (!extname(file) || !existsSync(file)) file = resolve(dir, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(readFileSync(file))
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

function capture(browser, url, out, profile) {
  const args = [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=3',
    '--window-size=390,844',
    // Let the SPA hydrate and fonts settle before the snap.
    '--virtual-time-budget=6000',
    `--screenshot=${out}`,
    url,
  ]
  /* Hard timeout: a hung Chrome must fail this shot, never wedge the build.
     (Seen in practice: the registered service worker keeps virtual time busy.) */
  const result = spawnSync(browser, args, { encoding: 'utf8', timeout: 45_000 })
  if (result.error) throw result.error
  return existsSync(out)
}

/* Read the real width/height straight out of the PNG IHDR header, so the
   manifest never claims a size the file does not have. */
function pngSize(file) {
  const head = Buffer.alloc(24)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, head, 0, 24, 0)
  } finally {
    closeSync(fd)
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

const browser = chrome()
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[shots] dist/index.html missing — run `npm run build` first.')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const server = await serve(DIST)
const base = `http://127.0.0.1:${server.address().port}`
const profile = join(tmpdir(), `seatswap-shots-${process.pid}`)

const captured = []

try {
  for (const shot of SHOTS) {
    const tmp = join(profile, shot.name)
    mkdirSync(dirname(tmp), { recursive: true })
    /* ?sw=off is the app's own service-worker kill switch (docs/08): with no
       worker registered, virtual time settles and the snap is deterministic. */
    const ok = capture(browser, `${base}${shot.route}?sw=off`, tmp, join(profile, 'profile'))
    if (!ok) {
      console.error(`[shots] FAILED to capture ${shot.route} — is Chrome allowed to run?`)
      process.exitCode = 1
      continue
    }
    copyFileSync(tmp, join(OUT, shot.name))
    const { width, height } = pngSize(join(OUT, shot.name))
    captured.push({ ...shot, size: `${width}x${height}` })
    console.log(
      `[shots] ${shot.route} -> public/screenshots/${shot.name} ${width}x${height}`,
    )
  }
} finally {
  server.close()
  rmSync(profile, { recursive: true, force: true })
}

/* vite.config.ts builds the manifest from this file (same pattern as
   pwa.workbox.mjs), so the committed manifest and the committed PNGs cannot
   drift apart. Regenerate both with: npm run assets */
const module = `/* GENERATED by scripts/make-screenshots.mjs — do not edit by hand.
   Manifest screenshots (docs/08): what the install UI shows. */
export const screenshots = [
${captured
  .map(
    (s) =>
      `  {\n    src: '/screenshots/${s.name}',\n    sizes: '${s.size}',\n    type: 'image/png',\n    form_factor: 'narrow',\n    label: ${JSON.stringify(s.label)},\n  }`,
  )
  .join(',\n')}
]
`
writeFileSync(join(ROOT, 'pwa.assets.mjs'), module)
console.log('[shots] wrote pwa.assets.mjs (manifest screenshots)')
