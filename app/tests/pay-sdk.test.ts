/* Pay SDK loading: lazy script tags, offline-safe rejection (docs/06, 08). */
import { describe, expect, it } from 'vitest'

import { loadPaypal, loadRazorpay } from '@/lib/pay-sdk'

describe('pay SDK loading', () => {
  it('resolves instantly when the SDK is already present', async () => {
    ;(window as unknown as { Razorpay?: unknown }).Razorpay = {}
    await expect(loadRazorpay()).resolves.toBeUndefined()
    delete (window as unknown as { Razorpay?: unknown }).Razorpay
  })

  it('injects each checkout script exactly once', () => {
    document.head.querySelectorAll('script[src*="razorpay"], script[data-paypal-sdk]').forEach((s) => s.remove())
    const before = document.head.querySelectorAll('script').length
    const p1 = loadRazorpay()
    const p2 = loadPaypal('test')
    const scripts = [...document.head.querySelectorAll('script')]
    expect(scripts.filter((s) => s.src.includes('checkout.razorpay.com'))).toHaveLength(1)
    expect(scripts.filter((s) => s.hasAttribute('data-paypal-sdk'))).toHaveLength(1)
    expect(document.head.querySelectorAll('script').length).toBe(before + 2)
    // jsdom never fires onload: the promises simply stay pending, which is
    // exactly what the pay screens tolerate (status screen explains pending).
    void p1
    void p2
  })

  it('builds a capture-intent INR PayPal URL', () => {
    document.head.querySelectorAll('script[data-paypal-sdk]').forEach((s) => s.remove())
    void loadPaypal('abc 123')
    const script = document.head.querySelector('script[data-paypal-sdk]') as HTMLScriptElement
    expect(script.src).toContain('currency=INR')
    expect(script.src).toContain('intent=capture')
    expect(script.src).toContain(`client-id=${encodeURIComponent('abc 123')}`)
  })
})
