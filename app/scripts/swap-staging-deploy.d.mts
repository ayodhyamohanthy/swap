export const expectedConfig: Readonly<Record<string, string | boolean>>
export function validateConfig(config: unknown): void
export function preflight(token: string | undefined, fetcher?: typeof fetch): Promise<void>
