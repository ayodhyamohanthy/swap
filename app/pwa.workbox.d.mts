/* Types for pwa.workbox.mjs, so vite.config.ts stays type-safe. */
import type { GenerateSWOptions } from 'workbox-build'

export declare const swFilename: string
export declare const cacheNames: {
  readonly pages: string
  readonly assets: string
  readonly fonts: string
}
/** Everything except the two options that depend on the build output folder. */
export declare const workboxOptions: Omit<GenerateSWOptions, 'globDirectory' | 'swDest' | 'mode'>
