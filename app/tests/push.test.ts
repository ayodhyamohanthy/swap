/* Web push registration: permission respected, never blocking (docs/08). */
import { beforeEach, describe, expect, it } from 'vitest'

import { disablePushSubscription, ensurePushSubscription, pushEndpoint } from '@/lib/push'

function setNotification(permission: 'default' | 'denied' | 'granted') {
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission: async () => permission },
    configurable: true,
  })
}

describe('push registration', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // jsdom has no PushManager: every path must degrade, never throw.
    Object.defineProperty(window, 'Notification', { value: undefined, configurable: true })
  })

  it('reports unsupported without push APIs', async () => {
    await expect(ensurePushSubscription()).resolves.toMatchObject({ status: 'unsupported' })
    await expect(disablePushSubscription()).resolves.toBe(false)
    expect(pushEndpoint()).toBeNull()
  })

  it('respects a prior denial without prompting', async () => {
    const calls: string[] = []
    setNotification('denied')
    Object.defineProperty(window, 'PushManager', { value: {}, configurable: true })
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => { calls.push('get'); return null } } }) },
      configurable: true,
    })
    await expect(ensurePushSubscription()).resolves.toMatchObject({ status: 'denied' })
    expect(calls).toEqual([])
  })

  it('needs a VAPID key before subscribing', async () => {
    setNotification('granted')
    const ready = Promise.resolve({ pushManager: { getSubscription: async () => null } })
    Object.defineProperty(window.navigator, 'serviceWorker', { value: { ready }, configurable: true })
    await expect(ensurePushSubscription()).resolves.toMatchObject({ status: 'no-key' })
  })
})
