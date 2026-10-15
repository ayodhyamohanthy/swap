/* One HTML file - the SPA shell prerendered at `/` - is served for every
   route (Workers Static Assets SPA fallback). Hydration on a deep link used
   to compare that route's chrome against the home chrome in the served HTML:
   Settings dropped the strapline (text mismatch), /welcome/language dropped
   the whole TopBar + tab bar (HTML mismatch), and React threw the entire
   server-rendered tree away with a #418 on every SSR'd route but Home.

   The contract that fixes it: AppShell's first render (server or client)
   always draws HOME_CHROME, and the route's own chrome appears only after
   mount. These three cases guard each half of that contract plus the drift
   risk between the shell and the index route. */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/* AppShell reads its route through the router; these tests drive it directly,
   so the router hooks are stubbed (Link becomes a plain anchor - the tab
   bar's target routes are not what is being tested). */
const h = vi.hoisted(() => ({
  matches: [{ staticData: { chrome: 'setup' } }] as Array<{ staticData: unknown }>,
  path: '/welcome/language',
}))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useMatches: () => h.matches,
    useLocation: () => ({ pathname: h.path }),
    Link: (props: Record<string, unknown>) => {
      const { to, children, ...rest } = props
      return (
        <a href={String(to)} {...rest}>
          {children as never}
        </a>
      )
    },
  }
})

import { AppShell, HOME_CHROME } from '@/components/app-shell'
import { I18nProvider } from '@/lib/i18n'
import { Route as IndexRoute } from '@/routes/index'

function shell() {
  return (
    <I18nProvider>
      <AppShell>
        <p>route content</p>
      </AppShell>
    </I18nProvider>
  )
}

afterEach(() => cleanup())

describe('prerendered-shell hydration parity', () => {
  it('renders the home chrome on the server whatever the route asks for', () => {
    /* The route here wants setup chrome (no TopBar, no tab bar); the served
       HTML must still be the home chrome, or hydration mismatches. */
    const html = renderToString(shell())
    expect(html).toContain('<nav')
    expect(html).toContain('A more comfortable journey together')
    expect(html).not.toContain('pt-10')
  })

  it('switches to the route chrome after mount on the client', () => {
    const { container } = render(shell())
    expect(container.querySelector('nav')).toBeNull()
    expect(container.querySelector('main')?.className).toContain('pt-10')
  })

  it('keeps the index route staticData and HOME_CHROME as one object', () => {
    /* If Home's own chrome drifts from HOME_CHROME, `/` itself starts
       mismatching its own prerender. */
    expect(IndexRoute.options.staticData).toBe(HOME_CHROME)
  })
})
