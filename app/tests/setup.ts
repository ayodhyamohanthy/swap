import { afterEach } from 'vitest'

/* jsdom ships no WebCrypto; the PNR hashing uses SHA-256, so lend it Node's.
   Fetched via getBuiltinModule because a static `import 'node:crypto'` gets
   mangled by Vite's browser-compat externalization under the jsdom pool. */
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = process.getBuiltinModule('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})
