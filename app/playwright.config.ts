import { defineConfig } from '@playwright/test'

/* E2E suite — docs/17 W6.1 ("Playwright suite … no keys needed — start any
   time"), the agent half of build-plan step 14 (QA). Keyless by construction:
   the app is local-first, so every flow here drives the real built bundle with
   a seeded localStorage and no backend, no gateway and no Supabase.

   Two viewports, because docs/05 makes a screen "done" only at 360 and 1440
   (360/430/768/1440 in the prose): `mobile-360` is the design baseline and
   `desktop-1440` is where the admin console lays out its sidebar.

   The server is `scripts/serve-dist.mjs` serving `dist/client`, so a run
   always tests the artefact `npm run build` produced — hence the build step in
   the `test:e2e` script rather than a dev server here. */

const PORT = Number(process.env.E2E_PORT ?? 4319)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  /* No trace/video/screenshots: this suite's job is assertions, and artefacts
     would accumulate per run in a repo that already fights stray files. */
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 780 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `node scripts/serve-dist.mjs --port ${PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
