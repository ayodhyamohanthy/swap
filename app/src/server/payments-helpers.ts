/* Helpers split so server modules stay small (docs/06 secrets, server only). */
export function serverEnv(name: string): string {
  const v = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.[name]
  if (!v) throw new Error(`missing_env:${name}`)
  return v
}
export function paypalWebhookId(): string {
  return serverEnv('PAYPAL_WEBHOOK_ID')
}
