/** Readiness-only staging boundary. No DB, provider, job or mail imports.
 * Do not mount the existing worker.ts until durable payment effects and the
 * TanStack server-function runtime have passed isolated staging gates.
 */
const capabilities = {
  environment: 'staging',
  ready: false,
  serverFunctions: false,
  database: false,
  webhooks: { razorpay: false, paypal: false },
  jobs: false,
  settlesPayments: false,
} as const

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }
    if (path === '/api/public/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, ...capabilities }), { status: 200, headers })
    }
    if (path === '/api/public/ready' && request.method === 'GET') {
      return new Response(JSON.stringify({ error: 'backend_not_configured', ...capabilities }), {
        status: 503, headers,
      })
    }
    // Never ack a payment, accept a job or impersonate a working SPA/API.
    return new Response(JSON.stringify({ error: 'staging_backend_disabled' }), {
      status: 503, headers,
    })
  },
}
