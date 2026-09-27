/* Helpers split so server modules stay small (docs/06 secrets, server only). */
export function serverEnv(name: string): string {
  const v = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.[name]
  if (!v) throw new Error(`missing_env:${name}`)
  return v
}
export function optionalEnv(name: string): string {
  return (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.[name] ?? ''
}
export function paypalWebhookId(): string {
  return serverEnv('PAYPAL_WEBHOOK_ID')
}

/* ---- shared plumbing for the real provider clients (docs/06) ----

   `createServerFn` handlers cannot be called directly from a test (TanStack Start
   wraps them in a transport), and hitting live payment APIs in CI is unacceptable.
   Every provider interaction therefore lives behind a `ProviderDeps` so the request
   shape and response handling get real tests. The server functions are thin. */

export interface ProviderDeps {
  /** Defaults to globalThis.fetch; tests supply a stub. */
  fetch?: typeof fetch
  env?: (name: string) => string
}

/** Marks every transport-level provider failure so callers never confuse them
    with business rejections (which are returned, not thrown). */
export class ProviderUnavailableError extends Error {
  readonly code: string
  override readonly cause?: unknown
  constructor(code: string, cause?: unknown) {
    super(code)
    this.name = 'ProviderUnavailableError'
    this.code = code
    this.cause = cause
  }
}

export function depsFromEnv(): ProviderDeps {
  return {
    fetch: typeof fetch === 'function' ? fetch : undefined,
    env: (name) => (name in process.env ? (process.env[name] ?? '') : ''),
  }
}

export function basicAuth(user: string, secret: string): string {
  return Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')
}

/** One JSON call, with every failure mode turned into a typed error rather than
    an unhandled rejection inside a payment flow. */
export async function callJson(
  deps: ProviderDeps,
  url: string,
  init: RequestInit,
  label: string,
): Promise<Record<string, unknown>> {
  const doFetch = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined)
  if (!doFetch) throw new ProviderUnavailableError('no_fetch_available')
  let response: Response
  try {
    response = await doFetch(url, init)
  } catch (error) {
    throw new ProviderUnavailableError(`${label}_network`, error)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new ProviderUnavailableError(`${label}_http_${response.status}`, new Error(text.slice(0, 500)))
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ProviderUnavailableError(`${label}_bad_json`, new Error(text.slice(0, 200)))
  }
}

export function requireEnv(deps: ProviderDeps, name: string): string {
  const value = deps.env?.(name) ?? ''
  if (!value) throw new Error(`missing_env:${name}`)
  return value
}

/* Credit-hold release plan (rule 6). When a gateway payment fails AFTER a
   credit hold was written at order time, the hold must be deleted — never
   left spent, never "refunded" through a provider. The executor deletes the
   rows matching this spec, then writes activity_log. */
export interface CreditHoldRelease {
  table: 'wallet_tx'
  user_id: string
  ref_request_id: string
  kind: 'used'
  /** Only holds written for this checkout (at or after the payment row). */
  created_at_gte: string
  /** Exact hold amount; never releases a different spend. */
  amount_paise: number
}
export function planCreditHoldRelease(input: {
  userId: string
  requestId: string
  creditUsedPaise: number
  paymentCreatedAt: string
}): CreditHoldRelease | null {
  if (!Number.isInteger(input.creditUsedPaise) || input.creditUsedPaise <= 0) return null
  if (!input.userId || !input.requestId || !input.paymentCreatedAt) return null
  return {
    table: 'wallet_tx',
    user_id: input.userId,
    ref_request_id: input.requestId,
    kind: 'used',
    created_at_gte: input.paymentCreatedAt,
    amount_paise: -input.creditUsedPaise,
  }
}
