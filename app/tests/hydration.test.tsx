/* The repo's first render test — and the guard for the bug class that
   typecheck, the full suite and the build all missed twice.

   Why it is needed at all. Only the **shell** is server-rendered: route content
   renders after hydration inside an empty Suspense boundary, so a route-level
   hydration mismatch is impossible and the shell is the whole surface where one
   can occur. Within that surface, any value derived from a store during render
   must be identical on the server and on the client's *first* render. The stores
   are populated from localStorage at module load, while `getServerSnapshot()`
   deliberately returns an empty state, so a render that reads the live store
   instead of the snapshot writes markup the server never wrote and React throws
   the entire tree away:

     Error: Hydration failed because the server rendered HTML didn't match the
     client.   + aria-label="Swaps, 2 new"   - aria-label="Swaps"

   That shipped, and nothing in this repo could see it. `useUnreadUpdates` was
   the only hook in `lib/use-store.ts` that subscribed with
   `useSyncExternalStore` and then ignored its own snapshot; every sibling read
   from the snapshot, which is exactly why the outlier survived review.

   How the two sides are separated here. In a real browser the server process
   has no localStorage and the client does. In jsdom there is one process and
   one module registry, so both renders would see the same state and the bug
   would hide. The helper below therefore reproduces the asymmetry explicitly:
   capture the markup while the store is **empty**, then populate the store, then
   hydrate that captured markup. A hook that reads live state now renders a
   different value from the one in the HTML, and React says so.

   This is deliberately narrow. It guards the contract for a hook that renders a
   store-derived value in the shell — it is not a general "hydrate the app" test,
   which would need the router context. Add a case here when a new shell
   component starts rendering store data. */

import { act, type ReactNode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { unreadUpdates } from '@/lib/requests'
import { credit, resetStore } from '@/lib/store'
import { useUnreadUpdates } from '@/lib/use-store'

/* React only treats `act` as authoritative when this flag is set; without it
   `act` is a pass-through and hydration work would not be flushed. */
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

/*
 * The Swaps tab, reduced to the one property under test: a value derived from
 * the store during render.
 *
 * The markup deliberately mirrors `TabBar` in `components/app-shell.tsx` — an
 * aria-label that changes *and* a conditional badge child. That distinction is
 * load-bearing. With only the attribute differing, React reports the mild
 * variant of the error ("some attributes … didn't match. This won't be patched
 * up") and leaves the server's value in place. The real badge also adds a
 * `<span>`, so the mismatch is structural and React discards the whole tree:
 * "this tree will be regenerated on the client". This probe reproduces the
 * severe one, which is the one that shipped.
 *
 * `<Link>` is not used because it needs a router; the structural property being
 * tested does not depend on it.
 */
function SwapsTab({ label = 'Swaps' }: { label?: string } = {}) {
  const unread = useUnreadUpdates()
  const badge = unread.length
  return (
    <span aria-label={badge > 0 ? `${label}, ${badge} new` : label}>
      {label}
      {badge > 0 ? <span aria-hidden>{badge > 9 ? '9+' : badge}</span> : null}
    </span>
  )
}

/** Render as a process with no localStorage would — `getServerSnapshot()`. */
function renderOnServer(node: ReactNode): string {
  return renderToString(node)
}

/**
 * Let React finish the work hydration schedules.
 *
 * `useSyncExternalStore` re-renders once from a passive effect to move from the
 * server snapshot to the live one, and that lands after `hydrateRoot` returns.
 * Without draining it React warns "an update was not wrapped in act(...)" — on
 * `console.error`, which is the channel this test reads. A microtask is not
 * enough; it needs a macrotask.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Hydrate `html` and return everything React complained about.
 *
 * Both channels are captured: React 19 reports a structural mismatch through
 * `console.error`, and hands recoverable ones to `onRecoverableError`.
 */
async function hydrateAndCollect(html: string): Promise<string[]> {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)

  const complaints: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    complaints.push(args.map((arg) => String(arg)).join(' '))
  })
  let root: Root | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, <SwapsTab />, {
        onRecoverableError: (error) => complaints.push(String(error)),
      })
    })
    await settle()
  } finally {
    /* Unmount before restoring the spy. A root left mounted keeps a pending
       store re-render alive, which then fires during whichever test runs next
       and is reported against *that* test — three phantom `act` warnings that
       looked like they came from the following case. */
    if (root) await act(async () => root?.unmount())
    spy.mockRestore()
    container.remove()
  }
  return complaints
}

/** A device that genuinely has something to show. */
function deviceWithUnreadUpdates(): void {
  credit({ to: 'acceptor', amountPaise: 5000, kind: 'acceptor_credit' })
  expect(unreadUpdates().length).toBeGreaterThan(0)
}

describe('the shell hydrates against what the server rendered', () => {
  beforeEach(() => {
    resetStore()
  })

  it('renders no badge on the server, and none on the client’s first render either', async () => {
    /* Server: nothing to show, so no count in the markup. */
    const html = renderOnServer(<SwapsTab />)
    expect(html).not.toMatch(/new/)

    /* Client: by the time React hydrates, this device has an unread update.
       The count is real — it just must not appear during hydration. */
    deviceWithUnreadUpdates()

    const complaints = await hydrateAndCollect(html)
    expect(complaints.filter((entry) => /hydrat/i.test(entry))).toEqual([])
  })

  it('shows the real count once hydrated, so the guard cannot pass by rendering nothing', async () => {
    const html = renderOnServer(<SwapsTab />)
    deviceWithUnreadUpdates()

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    let root: Root | undefined
    await act(async () => {
      root = hydrateRoot(container, <SwapsTab />)
    })
    await settle()
    /* The subscription's post-hydration re-render is the designed behaviour,
       not a workaround — without this assertion a hook that always returned []
       would satisfy the test above. */
    expect(container.querySelector('span')?.getAttribute('aria-label')).toMatch(/new/)
    if (root) await act(async () => root?.unmount())
    container.remove()
  })
})
