import { fileURLToPath } from 'node:url'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/* Tests run without the TanStack Start plugin: they cover the pure logic
   (PNR parsing, store, i18n, money) and rendered screens through the router. */
export default defineConfig({
  plugins: [viteReact()],
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
       ~22 of the 31 files and still reports success.
       forks + 4 workers is green in ~3m40s (31 files / 415 tests). Four
       leaves headroom on the 6-core dev machine for other lanes. */
    pool: 'forks',
    maxWorkers: 4,
  },
})
