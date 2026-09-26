/* Lazy payment SDKs — loaded ONLY on pay routes, never precached by the SW
   (pwa.workbox.mjs already NetworkOnly-matches razorpay/paypal hosts). */
export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('sdk_load_failed'))
    document.head.appendChild(s)
  })
}
export function loadPaypal(clientId: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (document.querySelector('script[data-paypal-sdk]')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.dataset.paypalSdk = '1'
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=INR&intent=capture`
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('sdk_load_failed'))
    document.head.appendChild(s)
  })
}
