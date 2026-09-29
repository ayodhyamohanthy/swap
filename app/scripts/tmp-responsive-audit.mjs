/* Responsive layout audit (AGENTS.md rule 12a) — DIAGNOSTIC ONLY, changes nothing.
 * Enumerates app/src/routes/*.tsx -> URLs, loads each at 360/430/768/1440,
 * measures horizontal overflow + genuinely clipped text with real Chrome.
 * Not a project dependency (puppeteer-core installed with --no-save).
 *   node app/scripts/tmp-responsive-audit.mjs
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const routesDir = join(here, '..', 'src', 'routes')
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const WIDTHS = (process.env.WIDTHS || '360,430,768,1440').split(',').map(Number)
const SETTLE = Number(process.env.SETTLE || 1300)
const CONC = Number(process.env.CONC || 3)
const OUT = process.env.OUT || '/tmp/responsive-audit.json'

const PARAM = {
  id: 'x_1',
  tripId: 'x_trip',
  requestId: 'x_req',
  number: '12951',
  code: 'ABC123',
  trainDate: '12951-2026-09-28',
}

/* TanStack file-route name -> concrete URL */
function toUrl(file) {
  const base = file.replace(/\.tsx$/, '')
  if (base === '__root') return null
  const parts = base.split('.').filter((s) => s !== 'index')
  if (parts.length === 0) return '/'
  return (
    '/' +
    parts
      .map((s) => (s.startsWith('$') ? (PARAM[s.slice(1)] ?? `x_${s.slice(1)}`) : s))
      .join('/')
  )
}

const files = readdirSync(routesDir)
  .filter((f) => f.endsWith('.tsx') && f !== '__root.tsx')
  .sort()

/* One entry per DISTINCT url; a layout file and its index child share a URL. */
const urlMap = new Map()
for (const f of files) {
  const u = toUrl(f)
  if (!u) continue
  if (!urlMap.has(u)) urlMap.set(u, [])
  urlMap.get(u).push(f)
}
const routes = [...urlMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chrome)) {
  console.error('Chrome not found at', chrome)
  process.exit(1)
}
const puppeteer = (await import('puppeteer-core')).default
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ],
})

/* ---- in-page measurement (must be self-contained: runs via page.evaluate) ---- */
const probe = (innerW) => {
  const de = document.documentElement
  const body = document.body
  const all = [de, body, ...document.querySelectorAll('body *')]
  const cls = (el) =>
    typeof el.className === 'string' ? el.className : ''
  const snippet = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  const depthOf = (el) => {
    let d = 0
    let p = el.parentElement
    while (p) {
      d++
      p = p.parentElement
    }
    return d
  }
  const desc = (el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: cls(el).slice(0, 200),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      depth: depthOf(el),
      overflowX: cs.overflowX,
      pos: cs.position,
      ws: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      display: cs.display,
      text: snippet(el),
      own: ownText(el).slice(0, 80),
    }
  }
  /* nearest ancestor that actually clips horizontally */
  const clipsBy = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      const o = getComputedStyle(p).overflowX
      if (o === 'hidden' || o === 'scroll' || o === 'auto' || o === 'clip') {
        return `${p.tagName.toLowerCase()}.${cls(p).split(' ').filter(Boolean).slice(0, 5).join('.')}`
      }
      p = p.parentElement
    }
    return null
  }

  /* a. document-level horizontal overflow */
  const res = {
    innerWidth: innerW,
    docScrollWidth: de.scrollWidth,
    docClientWidth: de.clientWidth,
    bodyScrollWidth: body ? body.scrollWidth : 0,
    bodyClientWidth: body ? body.clientWidth : 0,
    overflowVsInner: de.scrollWidth - innerW,
    overflowVsClient: de.scrollWidth - de.clientWidth,
    bodyOverflowVsInner: (body ? body.scrollWidth : 0) - innerW,
    bodyVsDoc: (body ? body.scrollWidth : 0) - de.scrollWidth,
    canScrollRight: de.scrollWidth > de.clientWidth + 1,
    renderedTextChars:
      (document.querySelector('main')?.innerText || body?.innerText || '').length,
  }

  /* b. elements whose right edge passes the viewport edge */
  const offending = new Set()
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > innerW + 1) offending.add(el)
  }
  const offenders = []
  for (const el of offending) {
    const parentOffends = el.parentElement ? offending.has(el.parentElement) : false
    const cb = clipsBy(el)
    offenders.push({
      ...desc(el),
      parentAlsoOffends: parentOffends,
      deepest: !parentOffends,
      clippedByAncestor: cb,
      /* only these can actually push the document wider */
      drivesScroll:
        !parentOffends && getComputedStyle(el).position !== 'fixed' && !cb,
    })
  }
  offenders.sort((a, b) => b.right - a.right)
  res.offenderCount = offenders.length
  res.deepestOffenders = offenders.filter((o) => o.deepest).slice(0, 14)
  res.scrollDrivers = offenders.filter((o) => o.drivesScroll).slice(0, 10)

  /* c. genuinely clipped text (rule 12a: "no clipped text") */
  const clipped = []
  for (const el of all) {
    if (el === de || el === body) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'hidden' || cs.overflowX === 'scroll') continue
    if (cs.textOverflow === 'ellipsis') continue
    if (!(el.scrollWidth > el.clientWidth + 2)) continue
    if (el.clientWidth <= 0) continue
    const t = ownText(el)
    if (!t) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const tag = el.tagName.toLowerCase()
    clipped.push({
      ...desc(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      clipBy: el.scrollWidth - el.clientWidth,
      nativeScroller: tag === 'textarea' || tag === 'select' || tag === 'option',
      isInput: tag === 'input',
      clippedByAncestor: clipsBy(el),
    })
  }
  clipped.sort((a, b) => b.clipBy - a.clipBy)
  res.clippedCount = clipped.length
  res.clipped = clipped.slice(0, 16)
  return res
}


/* ---- runner: isolated browser context per check => identical state at each width ---- */
async function check(url, width) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  const rec = { url, width, files: urlMap.get(url) }
  try {
    await page.setViewport({ width, height: 800 })
    const resp = await page.goto(BASE + url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    })
    rec.status = resp ? resp.status() : null
    await page.evaluate(() => document.fonts.ready.catch(() => {}))
    await new Promise((r) => setTimeout(r, SETTLE))
    rec.finalPath = new URL(page.url()).pathname
    rec.redirected = rec.finalPath !== url
    Object.assign(rec, await page.evaluate(probe, width))
  } catch (e) {
    rec.error = String((e && e.message) || e).slice(0, 180)
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  }
  return rec
}

const jobs = []
for (const [url] of routes) for (const width of WIDTHS) jobs.push([url, width])
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
if (ONLY) {
  const keep = jobs.filter(([u]) => ONLY.has(u))
  jobs.length = 0
  jobs.push(...keep)
}

const results = []
let next = 0
let done = 0
async function worker() {
  while (next < jobs.length) {
    const [url, width] = jobs[next++]
    const rec = await check(url, width)
    results.push(rec)
    const flag = rec.error
      ? 'ERR '
      : rec.overflowVsInner > 1
        ? 'OVF '
        : rec.clippedCount > 0
          ? 'CLIP'
          : 'ok  '
    console.log(
      `[${++done}/${jobs.length}] ${flag} ${url} @${width}` +
        (rec.error
          ? ` ${rec.error}`
          : ` ovf=${rec.overflowVsInner} clip=${rec.clippedCount} txt=${rec.renderedTextChars}${rec.redirected ? ` ->${rec.finalPath}` : ''}`),
    )
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

results.sort((a, b) => a.url.localeCompare(b.url) || a.width - b.width)
const errored = results.filter((r) => r.error)
const ovf = results.filter((r) => !r.error && r.overflowVsInner > 1)
const clip = results.filter((r) => !r.error && r.clippedCount > 0)
const failing = results.filter(
  (r) => !r.error && (r.overflowVsInner > 1 || r.clippedCount > 0),
)

writeFileSync(OUT, JSON.stringify({ routeFiles: files, routes, widths: WIDTHS, results }, null, 1))
console.log(
  JSON.stringify(
    {
      routeFiles: files.length,
      distinctUrls: routes.length,
      widths: WIDTHS,
      checks: results.length,
      errored: errored.length,
      overflowFailures: ovf.length,
      clippedFailures: clip.length,
      failingPairs: failing.length,
      passing: results.length - failing.length - errored.length,
      out: OUT,
    },
    null,
    1,
  ),
)
await browser.close()

