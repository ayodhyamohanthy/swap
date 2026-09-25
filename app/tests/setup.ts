import { webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'

/* jsdom ships no WebCrypto; the PNR hashing uses SHA-256, so lend it Node's. */
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})
