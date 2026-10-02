/* Probe: how many console/page errors does a PLAIN load of each route raise?
   No seeding, no interaction — this measures the shipped artefact. */
import { chromium } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4399'
const ROUTES = ['/', '/trips', '/swaps', '/profile', '/requests', '/updates']

const browser = await chromium.launch()
for (const route of ROUTES) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().split('\n')[0]}`)
  })
  await page.goto(BASE + route, { waitUntil: 'load' })
  await page.waitForTimeout(1200)
  const main = await page.evaluate(() => document.querySelector('main')?.innerText?.slice(0, 60) ?? '<no main>')
  console.log(`\n${route}  →  ${errors.length} error(s)`)
  for (const e of errors) console.log('   ', e)
  console.log('    main:', JSON.stringify(main))
  await context.close()
}
await browser.close()
