import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Staff / non-staff / anonymous / unconfigured boundary for the admin server
   guard, run against a fake Supabase client whose RPC answers like Postgres
   would. This proves the guard's decision logic locally; it does NOT prove the
   real database functions has_role()/is_staff() or RLS - that needs a live
   staging project (docs/cloudflare.md names it as the next gate). */
const state: { client: unknown } = { client: null }
vi.mock('@/lib/supabase', () => ({ getSupabase: async () => state.client }))
/* createServerFn needs a running Start request context; swap it for a plain
   builder so the handler body (the guard itself) is what runs. */
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const b: Record<string, unknown> = {}
    let validator: (i: unknown) => unknown = (i) => i
    b.validator = (v: (i: unknown) => unknown) => ((validator = v), b)
    b.handler = (h: (a: { data: unknown }) => unknown) => (arg: { data: unknown }) => h({ data: validator(arg.data) })
    return b
  },
}))

import { requireRole } from '@/server/admin'

function fake(opts: { user: { id: string } | null; admin?: unknown; staff?: unknown; rpcError?: boolean }) {
  const calls: string[] = []
  return {
    calls,
    client: {
      auth: { getUser: async () => ({ data: { user: opts.user }, error: null }) },
      rpc: async (fn: string) => {
        calls.push(fn)
        if (opts.rpcError) return { data: null, error: new Error('rpc failed') }
        return { data: fn === 'has_role' ? opts.admin : opts.staff, error: null }
      },
    },
  }
}
const call = (role: 'admin' | 'support') => requireRole({ data: { role } } as never)

describe('admin server guard (fake backend)', () => {
  beforeEach(() => {
    state.client = null
  })
  it('fails closed when no backend is configured', async () => {
    await expect(call('admin')).rejects.toThrow('backend_unconfigured')
  })
  it('refuses an anonymous caller before asking the database for a role', async () => {
    const f = fake({ user: null })
    state.client = f.client
    await expect(call('admin')).rejects.toThrow('not_signed_in')
    expect(f.calls).toEqual([])
  })
  it('refuses a signed-in non-staff user for admin and for support', async () => {
    const f = fake({ user: { id: 'u1' }, admin: false, staff: false })
    state.client = f.client
    await expect(call('admin')).rejects.toThrow('forbidden')
    await expect(call('support')).rejects.toThrow('forbidden')
  })
  it('refuses when the role RPC errors instead of assuming staff', async () => {
    const f = fake({ user: { id: 'u1' }, rpcError: true })
    state.client = f.client
    await expect(call('admin')).rejects.toThrow('forbidden')
  })
  it('only an exact true from the database admits a caller', async () => {
    state.client = fake({ user: { id: 'u1' }, admin: 'true' }).client
    await expect(call('admin')).rejects.toThrow('forbidden')
    state.client = fake({ user: { id: 'u1' }, admin: true }).client
    await expect(call('admin')).resolves.toEqual({ ok: true, uid: 'u1' })
  })
  it('support staff pass the support check but not the admin check', async () => {
    const f = fake({ user: { id: 's1' }, admin: false, staff: true })
    state.client = f.client
    await expect(call('support')).resolves.toEqual({ ok: true, uid: 's1' })
    await expect(call('admin')).rejects.toThrow('forbidden')
  })
})
