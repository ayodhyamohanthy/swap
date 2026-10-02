import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:4399'
const cases = [
  { name: 'no localStorage at all', init: undefined },
  { name: 'seen = {} (fresh)', init: { 'seatswap.lang.v1': 'en', 'seatswap.seen.v1': {} } },
  {
    name: 'seen = all true',
    init: {
      'seatswap.lang.v1': 'en',
      'seatswap.seen.v1': { language: true, note: true, privacy: true, alerts: true, signin_asked: true },
    },
  },
]
const browser = await chromium.launch()
for (const c of cases) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } })
  const page = await context.newPage()
  if (c.init) await page.addInitScript((d) => {
    for (const [k, v] of Object.entries(d)) window.localStorage.setItem(k, JSON.stringify(v))
  }, c.init)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split(';')[0]))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().split(';')[0]) })
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  const main = await page.evaluate(() => document.querySelector('main')?.innerText?.slice(0, 45) ?? '')
  console.log(`${c.name.padEnd(24)} → ${errors.length} error(s)  url=${new URL(page.url()).pathname}`)
  for (const e of errors) console.log('      ', e)
  console.log('      main:', JSON.stringify(main))
  await context.close()
}
await browser.close()
