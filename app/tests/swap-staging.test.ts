import { describe, expect, it, vi } from 'vitest'
import worker from '../src/staging-worker'
import { expectedConfig, preflight, validateConfig } from '../scripts/swap-staging-deploy.mjs'

describe('isolated staging runtime', () => {
  it('reports liveness without claiming readiness', async () => {
    const response = await worker.fetch(new Request('https://staging/api/public/health'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      ok: true, environment: 'staging', ready: false, serverFunctions: false,
      database: false, webhooks: { razorpay: false, paypal: false },
      jobs: false, settlesPayments: false,
    })
  })
  it('fails readiness', async () => {
    const response = await worker.fetch(new Request('https://staging/api/public/ready'))
    expect(response.status).toBe(503)
    expect((await response.json()).ready).toBe(false)
  })
  it.each([
    ['POST', '/api/public/webhooks/razorpay'],
    ['POST', '/api/public/webhooks/paypal'],
    ['POST', '/api/public/jobs/run'],
    ['POST', '/_server/example'],
    ['GET', '/api/private/payments'],
    ['GET', '/'],
    ['GET', '/trips/add'],
    ['POST', '/api/public/health'],
    ['DELETE', '/api/public/ready'],
    ['OPTIONS', '/api/public/health'],
  ])('never exposes an unconfigured action %s %s', async (method, path) => {
    const outbound = vi.spyOn(globalThis, 'fetch')
    try {
      const response = await worker.fetch(new Request('https://staging' + path, { method }))
      expect(response.status).toBe(503)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(await response.json()).toEqual({ error: 'staging_backend_disabled' })
      expect(outbound).not.toHaveBeenCalled()
    } finally { outbound.mockRestore() }
  })
})

describe('exact-target staging guard', () => {
  it('accepts only the reviewed staging manifest', () => {
    expect(() => validateConfig({ ...expectedConfig })).not.toThrow()
  })
  it.each([
    { name: 'seatswap' },
    { name: 'skipwait-worker' },
    { name: 'freecoffee-backend' },
    { name: 'swap-backend-prod' },
    { account_id: 'other-account' },
    { main: 'src/worker.ts' },
    { assets: { directory: './dist/cf' } },
    { vars: { SECRET: 'no' } },
    { kv_namespaces: [] },
    { routes: ['example.com/*'] },
    { triggers: { crons: ['* * * * *'] } },
    { env: { production: {} } },
  ])('rejects target, resource and execution overrides %j', patch => {
    expect(() => validateConfig({ ...expectedConfig, ...patch })).toThrow()
  })
  it('rejects missing fields', () => {
    const config = { ...expectedConfig }
    delete config.account_id
    expect(() => validateConfig(config)).toThrow()
  })
  function mockApi(bindings?: unknown[], account = expectedConfig.account_id, active = true) {
    return vi.fn<typeof fetch>(async input => {
      const path = String(input)
      const result = path.endsWith('/verify') ? { status: active ? 'active' : 'disabled' }
        : path.endsWith('/accounts') ? [{ id: account }]
          : bindings === undefined ? null : { bindings }
      return result === null ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ success: true, result }))
    })
  }
  it('verifies account and exact worker before allowing a new deployment', async () => {
    const api = mockApi()
    await expect(preflight('test-token', api)).resolves.toBeUndefined()
    expect(api.mock.calls.map(call => String(call[0]))).toEqual([
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      'https://api.cloudflare.com/client/v4/accounts',
      'https://api.cloudflare.com/client/v4/accounts/' + expectedConfig.account_id +
        '/workers/scripts/swap-backend-staging/settings',
    ])
  })
  it('allows an existing unbound staging worker', async () => {
    await expect(preflight('test-token', mockApi([]))).resolves.toBeUndefined()
  })
  it('refuses inherited secrets or bindings', async () => {
    await expect(preflight('test-token', mockApi([{ type: 'secret_text', name: 'KEY' }]))).rejects.toThrow()
  })
  it('refuses the wrong account', async () => {
    await expect(preflight('test-token', mockApi(undefined, 'other'))).rejects.toThrow()
  })
  it('refuses an inactive token', async () => {
    await expect(preflight('test-token', mockApi(undefined, expectedConfig.account_id, false))).rejects.toThrow()
  })
  it('refuses absent tokens before network access', async () => {
    const api = mockApi()
    await expect(preflight(undefined, api)).rejects.toThrow()
    expect(api).not.toHaveBeenCalled()
  })
  it('fails closed on API denial', async () => {
    await expect(preflight('test-token', vi.fn(async () => new Response('{}', { status: 403 })))).rejects.toThrow()
  })
})
