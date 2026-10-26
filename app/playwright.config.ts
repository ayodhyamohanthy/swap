/* docs/17 W6.1: the Playwright suite for the docs/04 flows, keyless, against
   the built static app. Two projects = the two W6.1 viewports (360, 1440).
   Serve the build yourself (`npm run build` first) — the webServer here only
   hosts dist/cf, it does not build. */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node e2e/static-server.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
})
