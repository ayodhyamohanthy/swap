import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(resolve(process.cwd(), 'src/components/app-shell.tsx'), 'utf8')

/* Guards the #418 fix. Reproduced with a deterministic warm-cache reload of any
   non-root route: React named (1) the tab bar Links - the router adds
   data-status="active" from the real URL while the shell is prerendered at "/",
   and (2) the route boundary - a cached route chunk rendered into the shell's
   empty boundary during hydration. A jsdom render cannot recreate the browser's
   cache timing, so these assert the structure that removed both mismatches. */
describe('shell hydration parity (#418)', () => {
  it('renders route content only after mount, so the first client render equals the prerendered shell', () => {
    expect(shell).toMatch(/\{mounted \? children : null\}/)
  })
  it('keeps the router active class off the tab links and rebuilds them once settled', () => {
    expect(shell).toContain('activeProps={{}}')
    expect(shell).toContain('inactiveProps={{}}')
    expect(shell).toContain('suppressHydrationWarning')
    expect(shell).toMatch(/key=\{`\$\{id\}:\$\{settled\}`\}/)
    expect(shell).toContain('settled={mounted}')
  })
})
