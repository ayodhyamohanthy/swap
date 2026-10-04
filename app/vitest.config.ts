import { fileURLToPath } from 'node:url'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/* Tests run without the TanStack Start plugin: they cover the pure logic
   (PNR parsing, store, i18n, money), the route tree, and source-scanning
   guards. This comment used to claim they also covered "rendered screens
   through the router" — they did not; no test rendered a component at all
   until `tests/hydration.test.tsx`, which is the first and renders one
   component directly (no router, which is why it needs none). */
export default defineConfig({
  plugins: [viteReact()],
  /* React picks its bundle on `process.env.NODE_ENV`: `index.js` loads
     `cjs/react.production.js` when that is "production" and
     `cjs/react.development.js` otherwise. Vitest sets it to "production", so
     tests were loading a React with no `act` — which is what made
     `tests/hydration.test.tsx` fail with `TypeError: act is not a function`
     and `React.act is not a function` (the latter from
     `react-dom/test-utils`, which just forwards to `React.act`).

     This is not a cosmetic setting. The development build is also where React
     keeps the development-only warnings this repo's guards are written
     against, and it is the only bundle that has `act` at all — so a hydration
     guard cannot run on the production bundle even in principle. Pinned here
     rather than in the test file so the whole suite gets it. */
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    /* The pool is pinned, not left to the default. jsdom construction costs
       ~50s per file on this machine, and the default unbounded worker count
       makes every worker boot time out — `Timeout waiting for worker to
       respond`, 180s, zero tests run — so `npm run test` (the green gate
       AGENTS.md §0 step 4 requires before every commit) did not work at all.
       `threads` is worse than failing: with parallel files it silently drops
       files and still reports success.
       Watch the **file** count, not the test count: tests are added by every
       lane, so "Test Files N passed" is the signal that no file was dropped —
       and it is only a signal if it is held against the real total. DO NOT
       hard-code that total here; it rots. This comment carried "31" while the
       directory held 72. Derive it instead:
           ls tests/*.test.ts tests/*.test.tsx | wc -l
       MEASURED 2026-10-04, on a machine under external load (load 17.6 on 12
       logical CPUs, ~43s of jsdom construction per file): a run reported
       "Test Files 51 passed (51) · Tests 713 passed (713) · 0 failed" while
       **21 of the 72 files never started at all**, every one a `Failed to
       start forks worker … Timeout waiting for worker to respond`. Zero
       failures, a green summary, 71% coverage — and the file that carried the
       repo's only known failures was among the 21, so the run looked BETTER
       than a complete one. That is the failure this comment exists to
       prevent. Read the file count before the verdict, and re-run the skipped
       files in small batches. The old "green in ~3m40s" figure described a
       smaller suite and is no longer a useful expectation. */
    pool: 'forks',
    maxWorkers: 4,
  },
})
