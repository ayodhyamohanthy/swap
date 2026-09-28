/* SeatSwap PWA store screenshots — real Chrome, real build, no paid asset tool.

   Builds nothing itself: run `npm run build` first. Serves dist/ over a tiny
   local static server (SPA fallback), then captures real screens via CDP
   with headless Chrome at a phone viewport and writes app/public/screenshots/*.png.

   Run: node app/scripts/make-screenshots.mjs
   Then wire the output into the manifest (vite.config.ts -> manifest.screenshots).
   Chrome path is auto-detected; override with CHROME=/path/to/chrome. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* The static host serves dist/client (that is also wrangler.toml's assets dir),
   so that is what we screenshot. */
const DIST = join(ROOT, 'dist', 'client')
const OUT = join(ROOT, 'public', 'screenshots')

/* Chrome-family binaries that can run headless, best option first: the real
   Chrome, then the Playwright "headless shell" many dev machines already have
   cached (it is the same engine and needs no --headless flag).
   Override with CHROME=/path/to/chrome. */
const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  // Playwright's cached headless shells (newest cache dir wins — see shellCandidates).
  ...shellCandidates(),
].filter(Boolean)

/* ~/Library/Caches/ms-playwright (mac), ~/.cache/ms-playwright (linux). */
function shellCandidates() {
  const roots = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ]
  const found = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const dir of readdirSync(root)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse()) {
      for (const sub of ['chrome-headless-shell-mac-x64', 'chrome-headless-shell-mac-arm64', 'chrome-linux']) {
        const bin = join(root, dir, sub, sub.includes('mac') ? 'chrome-headless-shell' : 'headless_shell')
        if (existsSync(bin)) found.push(bin)
      }
    }
  }
  return found
}

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

/**
 * Capture screenshots using Chrome DevTools Protocol (CDP) over WebSocket.
 *
 * Direct CLI invocation (`--screenshot`) hangs when SPAs hydrate or register
 * microtasks because Chrome's CLI waiting logic waits indefinitely for all
 * pending virtual tasks. CDP lets us explicitly navigate, wait for the page load
 * event, and snapshot deterministically.
 */
async function captureAll(browser, base, shots, profileDir) {
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    /* Resolve every EXTERNAL host to "not found" so `load` never waits on
       Supabase/CDN requests when the machine is offline or firewalled —
       SeatSwap's fonts are local (token stacks, no @import url()), so
       blocking the outside world costs no fidelity and makes the shot
       hermetic in CI. Loopback is EXCLUDED: without that, our own static
       server is unreachable and every shot is Chrome's DNS-error page
       (observed: two byte-identical "screenshots" that were both errors). */
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ]

  const proc = spawn(browser, args)

  // Listen to stderr to capture the ephemeral DevTools WebSocket URL
  const browserWs = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`Timeout waiting for DevTools on ${basename(browser)}`))
    }, 15_000)

    proc.stderr.on('data', (chunk) => {
      const match = chunk.toString().match(/ws:\/\/[^/]+\/devtools\/browser\/[a-zA-Z0-9-]+/)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  // Connect to the browser WebSocket
  const ws = new WebSocket(browserWs)
  let id = 1
  const callbacks = new Map()

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data)
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id)
      callbacks.delete(msg.id)
      cb(msg)
    }
  }

  const sendBrowser = (method, params = {}) =>
    new Promise((resolve) => {
      const curId = id++
      callbacks.set(curId, resolve)
      ws.send(JSON.stringify({ id: curId, method, params }))
    })

  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  // Find the initial page target
  const targets = await sendBrowser('Target.getTargets')
  const pageTarget = targets.result.targetInfos.find((t) => t.type === 'page')
  if (!pageTarget) {
    ws.close()
    proc.kill()
    throw new Error('No page target created by browser')
  }

  const pageWsUrl = browserWs.replace(
    /devtools\/browser\/[a-zA-Z0-9-]+/,
    'devtools/page/' + pageTarget.targetId,
  )
  const pageWs = new WebSocket(pageWsUrl)

  let pageId = 1
  const pageCallbacks = new Map()

  pageWs.onmessage = (evt) => {
    const msg = JSON.parse(evt.data)
    if (msg.id && pageCallbacks.has(msg.id)) {
      const cb = pageCallbacks.get(msg.id)
      pageCallbacks.delete(msg.id)
      cb(msg)
    }
  }

  const sendPage = (method, params = {}) =>
    new Promise((resolve) => {
      const curId = pageId++
      pageCallbacks.set(curId, resolve)
      pageWs.send(JSON.stringify({ id: curId, method, params }))
    })

  await new Promise((resolve, reject) => {
    pageWs.onopen = resolve
    pageWs.onerror = reject
  })

  await sendPage('Page.enable')
  await sendPage('Runtime.enable')
  await sendPage('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  })

  const results = []
  const shotDigests = new Set()

  /* Wait until the page really IS this shot's route with content on screen.
     Trusting `Page.loadEventFired` alone was observed to capture the PREVIOUS
     shot: a late duplicate load event from shot N-1 satisfied shot N's wait
     before its navigation committed, so both files came out byte-identical.
     Verifying location.pathname (and that <main> has text) makes a stray event
     harmless — the loop just keeps polling until the new page is up. */
  async function waitForShot(shot) {
    const wantPath = JSON.stringify(shot.route)
    const ready = `location.pathname === ${wantPath} && (document.querySelector('main')?.innerText.length ?? 0) > 20`
    const deadline = Date.now() + 15_000
    for (;;) {
      const ev = await sendPage('Runtime.evaluate', { expression: ready, returnByValue: true })
      if (ev.result?.result?.value === true) return
      if (Date.now() > deadline) {
        const where = await sendPage('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true })
        throw new Error(`Timeout: ${shot.route} never reached (stuck at ${where.result?.result?.value})`)
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  try {
    for (const shot of shots) {
      const url = `${base}${shot.route}?sw=off`
      const nav = await sendPage('Page.navigate', { url })
      if (nav.result?.errorText) throw new Error(`Navigate ${shot.route}: ${nav.result.errorText}`)
      await waitForShot(shot)
      /* Hydration + layout settle before the snap. */
      await new Promise((r) => setTimeout(r, 800))
      const shotRes = await sendPage('Page.captureScreenshot', { format: 'png' })
      const pngBuffer = Buffer.from(shotRes.result.data, 'base64')

      /* Belt-and-braces: two different routes must never produce identical
         bytes. If they do, a capture raced again — fail loudly rather than
         ship two install cards showing the same screen. */
      const digest = createHash('sha256').update(pngBuffer).digest('hex')
      if (shotDigests.has(digest)) {
        throw new Error(`${shot.route} produced a byte-identical image to an earlier shot — capture raced`)
      }
      shotDigests.add(digest)

      const outFile = join(OUT, shot.name)
      writeFileSync(outFile, pngBuffer)
      const { width, height } = pngSize(outFile)
      results.push({ ...shot, size: `${width}x${height}` })
      console.log(
        `[shots] ${shot.route} -> public/screenshots/${shot.name} ${width}x${height} via ${basename(browser)}`,
      )
    }
  } finally {
    pageWs.close()
    ws.close()
    proc.kill()
    await new Promise((resolve) => proc.on('exit', resolve))
  }

  return results
}

const chosenBrowser = chrome()
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[shots] dist/index.html missing — run `npm run build` first.')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const server = await serve(DIST)
const base = `http://127.0.0.1:${server.address().port}`
const profile = join(tmpdir(), `seatswap-shots-${process.pid}`)

let captured = []

try {
  // Try candidates in order until capture succeeds
  const order = [chosenBrowser, ...CHROME_CANDIDATES.filter((b) => b !== chosenBrowser)]
  for (const b of order) {
    try {
      captured = await captureAll(b, base, SHOTS, join(profile, 'profile'))
      if (captured.length === SHOTS.length) break
    } catch (err) {
      console.log(`[shots] ${basename(b)} failed: ${err.message}. Trying next candidate...`)
    }
  }
  if (captured.length !== SHOTS.length) {
    console.error('[shots] Failed to capture all screenshots.')
    process.exit(1)
  }
} finally {
  server.close()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // If OS file locks persist temporarily, ignore cleanup error
  }
}

/* vite.config.ts builds the manifest from this file (same pattern as
   pwa.workbox.mjs), so the committed manifest and the committed PNGs cannot
   drift apart. Regenerate both with: npm run assets */
const moduleContent = `/* GENERATED by scripts/make-screenshots.mjs — do not edit by hand.
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

writeFileSync(join(ROOT, 'pwa.assets.mjs'), moduleContent)
console.log(`[shots] wrote app/pwa.assets.mjs (${captured.length} screenshots)`)
