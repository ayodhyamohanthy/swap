/* Cloudflare Worker entry — the server runtime the static PWA has never had.
 *
 * WHY THIS FILE EXISTS
 * `vite.config.ts` builds a static SPA and `wrangler.toml` shipped only
 * `[assets]`, so every build wrote `dist/server/server.js` (all 23 server
 * functions + the payment logic) and then deployed nothing with it. The
 * consequence was not cosmetic: `/api/public/webhooks/*` was not routable
 * anywhere, so the thing that decides "the money is ours" could never fire,
 * while `gatewayLive()` told a paying traveller "we're waiting for your
 * bank" with no machinery that could ever answer. docs/06 and AGENTS.md's
 * tech-stack line already describe this contract — this file is the wiring,
 * not a new design.
 *
 * THE ONE RULE THIS FILE MUST NEVER BREAK
 * It may never mark a payment captured from anything but a verified provider
 * signal. `checkout.ts#confirmCaptured` locks a swap and spends credit, so a
 * worker that asserted capture would hand out swaps for free. That is why the
 * local-demo settle in the status screen stays gated on `!gatewayLive()`.
 *
 * STATUS OF THE EFFECTS
 * `applyWebhookEvent` returns a *plan* (lock_request, supersede_offers, …).
 * Executing it needs a service-role Supabase client, and that executor does
 * not exist yet. Until it does, a verified event answers **501
 * effects_not_wired** rather than 200, so the provider retries instead of us
 * silently dropping a real capture — the same refusal `jobs.ts` makes when it
 * has work but no `SERVICE_ROLE_KEY` ("a silent no-op wearing the costume of
 * a success").
 */

import {
  applyWebhookEvent,
  parseWebhook,
  paypalTransmission,
  signatureHeader,
  verifyPaypalWebhook,
  verifyRazorpayWebhook,
  WEBHOOK_PATHS,
  type WebhookProvider,
} from '@/server/webhooks'

/* Bundler-declared bindings only. `@cloudflare/workers-types` is deliberately
   NOT a dependency: everything here is standard Web Fetch API, and a type-only
   dep the deploy contract does not need is one more thing to go stale. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}
export interface WorkerEnv {
  ASSETS?: AssetsBinding
  RAZORPAY_WEBHOOK_SECRET?: string
  PAYPAL_WEBHOOK_ID?: string
  PAYPAL_CLIENT_ID?: string
  PAYPAL_CLIENT_SECRET?: string
  /** Guards POST /api/public/jobs/run; set with `wrangler secret put`. */
  JOB_RUNNER_SECRET?: string
  [name: string]: unknown
}

/** What the outside world may conclude from GET /api/public/health. */
export interface Capabilities {
  ok: true
  webhooks: { razorpay: boolean; paypal: boolean }
  jobs: boolean
  /** True only when a verified capture can actually settle a swap. */
  settlesPayments: boolean
}

/** The effect executor, injectable so this module is testable with no DB. */
export type ApplyEvent = (event: {
  provider: WebhookProvider
  providerRef: string
  kind: 'captured' | 'failed' | 'completed' | 'denied'
  payStatus: 'paid' | 'failed'
}) => Promise<{ ok: boolean; detail?: string }>

export interface WorkerDeps {
  env: WorkerEnv
  fetch?: typeof fetch
  /** Absent until the service-role write executor exists → 501, by design. */
  applyEvent?: ApplyEvent
}

export const HEALTH_PATH = '/api/public/health'
export const JOBS_PATH = '/api/public/jobs/run'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function headersOf(request: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  request.headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function envValue(env: WorkerEnv, name: string): string {
  const direct = env[name]
  if (typeof direct === 'string' && direct) return direct
  /* serverEnv() in the server modules reads process.env, which Workers only
     exposes from bindings under nodejs_compat. Reading both keeps one source
     of truth holding either way; bindings are immutable per-isolate values. */
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name] ?? ''
}

function seedProcessEnv(env: WorkerEnv): void {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  if (!proc?.env) return
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value && !proc.env[key]) proc.env[key] = value
  }
}

/**
 * Provider dedupe here is an optimisation only. The system of record is the
 * `provider_ref` unique constraint on `payments`, because this Set is
 * per-isolate and dies with it — a retry that lands on a cold isolate is
 * simply re-verified, and the DB rejects the second write.
 */
const seenRefs = new Set<string>()

export function capabilities(
  env: WorkerEnv,
  deps: Pick<WorkerDeps, 'applyEvent'> = {},
): Capabilities {
  const razorpay = Boolean(envValue(env, 'RAZORPAY_WEBHOOK_SECRET'))
  const paypal = Boolean(
    envValue(env, 'PAYPAL_WEBHOOK_ID') &&
      envValue(env, 'PAYPAL_CLIENT_ID') &&
      envValue(env, 'PAYPAL_CLIENT_SECRET'),
  )
  return {
    ok: true,
    webhooks: { razorpay, paypal },
    jobs: Boolean(envValue(env, 'JOB_RUNNER_SECRET')),
    settlesPayments: Boolean(deps.applyEvent),
  }
}

/** serverEnv() throws `Error("missing_env:X")`, which carries no `.code`; the
   operator has to see which binding is absent, not a blanket `verify_failed`. */
function verifyError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'verify_failed'
}

/** Razorpay signs the raw body; PayPal signs via its verify-webhook-signature API. */
async function verifyProvider(
  provider: WebhookProvider,
  request: Request,
  deps: WorkerDeps,
): Promise<{ ok: true; rawBody: string } | { ok: false; status: number; error: string }> {
  const rawBody = await request.text()
  const headers = headersOf(request)
  if (provider === 'razorpay') {
    const signature = signatureHeader('razorpay', headers)
    if (!signature) return { ok: false, status: 400, error: 'missing_signature' }
    try {
      const ok = await verifyRazorpayWebhook(rawBody, signature)
      return ok ? { ok: true, rawBody } : { ok: false, status: 400, error: 'bad_signature' }
    } catch (err) {
      /* A missing secret is an outage on our side, not a forgery: answer 503
         so the provider retries instead of us burning its retry budget. */
      return { ok: false, status: 503, error: verifyError(err) }
    }
  }
  const transmission = paypalTransmission(headers)
  if (!transmission) return { ok: false, status: 400, error: 'missing_transmission' }
  try {
    const ok = await verifyPaypalWebhook(
      { fetch: deps.fetch ?? globalThis.fetch, env: (name) => envValue(deps.env, name) },
      transmission,
      rawBody,
    )
    return ok ? { ok: true, rawBody } : { ok: false, status: 400, error: 'bad_signature' }
  } catch (err) {
    return { ok: false, status: 503, error: verifyError(err) }
  }
}

async function handleWebhook(
  provider: WebhookProvider,
  request: Request,
  deps: WorkerDeps,
): Promise<Response> {
  const verified = await verifyProvider(provider, request, deps)
  if (!verified.ok) return json(verified.status, { error: verified.error })

  const verdict = parseWebhook(provider, { rawBody: verified.rawBody, headers: headersOf(request) })
  if (verdict.status === 'rejected') {
    /* Ack rather than retry-loop: the provider keeps firing events we ignore
       (payment.created, refunds…) forever if we answer non-2xx. */
    return json(200, { ack: true, ignored: verdict.reason })
  }

  const plan = applyWebhookEvent(seenRefs, { providerRef: verdict.providerRef, kind: verdict.kind })
  if (plan.deduped) return json(200, { ack: true, deduped: true })
  if (!deps.applyEvent) {
    /* Undo the optimistic dedupe so a retry on the next isolate attempt is not
       swallowed locally while the executor is still missing. */
    seenRefs.delete(verdict.providerRef)
    return json(501, {
      error: 'effects_not_wired',
      provider: verdict.provider,
      providerRef: verdict.providerRef,
      payStatus: plan.payStatus,
      effects: plan.effects,
    })
  }
  try {
    const applied = await deps.applyEvent({
      provider: verdict.provider,
      providerRef: verdict.providerRef,
      kind: verdict.kind,
      payStatus: plan.payStatus ?? 'failed',
    })
    if (applied.ok) {
      return json(200, { ack: true, payStatus: plan.payStatus, effects: plan.effects })
    }
    seenRefs.delete(verdict.providerRef)
    return json(500, {
      error: 'apply_failed',
      providerRef: verdict.providerRef,
      detail: applied.detail ?? '',
    })
  } catch (err) {
    seenRefs.delete(verdict.providerRef)
    return json(500, { error: 'apply_failed', detail: err instanceof Error ? err.message : 'apply_failed' })
  }
}

function authorizedJobs(request: Request, env: WorkerEnv): boolean {
  const expected = envValue(env, 'JOB_RUNNER_SECRET')
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  return bearer === expected || (request.headers.get('x-job-secret') ?? '') === expected
}

/**
 * The whole router. Exported apart from the Worker default so tests can drive
 * it with a plain Request and no runtime.
 */
export async function route(request: Request, deps: WorkerDeps): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === HEALTH_PATH) {
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' })
    return json(200, { ...capabilities(deps.env, deps) })
  }

  const provider = (Object.keys(WEBHOOK_PATHS) as WebhookProvider[]).find(
    (name) => WEBHOOK_PATHS[name] === pathname,
  )
  if (!provider && pathname !== JOBS_PATH) {
    /* Everything that is not our contract is the PWA: same offline shell,
       service worker, cache version and all. */
    return deps.env.ASSETS ? deps.env.ASSETS.fetch(request) : json(404, { error: 'not_found' })
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (pathname === JOBS_PATH) {
    if (!authorizedJobs(request, deps.env)) return json(401, { error: 'unauthorized' })
    /* The five jobs in server/jobs.ts are createServerFn handlers behind a
       service-role write path that does not exist yet. The auth is real today
       so the surface cannot be "temporarily open" when the executor lands. */
    return json(501, { error: 'jobs_not_wired' })
  }
  return handleWebhook(provider as WebhookProvider, request, deps)
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    seedProcessEnv(env)
    return route(request, { env, fetch: globalThis.fetch })
  },
}

