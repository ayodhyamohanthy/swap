/* SeatSwap payments — Razorpay + PayPal + credit + demo bank (docs/06).
   Real providers activate when keys exist AND the server order/capture
   functions land (Step 6 backend). Until then the clearly-labeled demo bank
   processes the same created>pending>paid|failed machine, with QA controls
   to replay pending/failed/success (webhook replay tests, Step 14).
   Amount always ₹99 INR (₹199 group). Webhook stays source of truth server-side. */
const SeatSwapPay = (() => {
  const C = (typeof SeatSwapConfig !== 'undefined' ? SeatSwapConfig : {});
  const inr = (paise) => '₹' + (paise / 100).toFixed(paise % 100 ? 2 : 0);

  function methods() {
    // Razorpay surface: UPI first, then cards, net banking, wallets.
    return [
      { id: 'upi', icon: '◉', title: 'UPI', sub: 'GPay, PhonePe, Paytm, UPI ID' },
      { id: 'card', icon: '▭', title: 'Card', sub: 'Credit / Debit' },
      { id: 'netbanking', icon: '◈', title: 'Net banking', sub: 'All major banks' },
      { id: 'wallet', icon: '▣', title: 'Wallet', sub: 'Mobikwik, Ola Money & more' },
    ];
  }
  function realRazorpay() { return !!(C.razorpayKeyId && !C.demo); }
  function realPaypal() { return !!(C.paypalClientId && !C.demo); }

  /* Demo bank: resolves created>pending>paid|failed with controllable outcome.
     mode: 'auto' (succeed after 2s) | 'pending' | 'fail' — QA replay controls. */
  function chargeDemo(paymentId, mode, onEvent) {
    const emit = (st) => { try { onEvent && onEvent(st); } catch {} };
    emit('created');
    if (mode === 'fail') {
      setTimeout(() => { SeatSwapEngine.gatewayResult(paymentId, 'failed'); emit('failed'); }, 1200);
      return;
    }
    setTimeout(() => { SeatSwapEngine.gatewayResult(paymentId, 'pending'); emit('pending'); }, 900);
    if (mode !== 'pending') {
      setTimeout(() => { SeatSwapEngine.gatewayResult(paymentId, 'paid', 'demo_' + Date.now().toString(36)); emit('paid'); }, 2600);
    }
  }

  function receiptLines(payment) {
    const price = payment.amount_paise;
    const fee = Math.min(C.FEE_PAISE || 4900, price);
    return [
      { label: 'SeatSwap fee', amount: fee },
      { label: 'Thank-you credit', amount: price - fee },
      ...(payment.credit_used_paise > 0 ? [{ label: 'Credit used', amount: -payment.credit_used_paise }] : []),
      { label: 'Total charged', amount: price - payment.credit_used_paise, total: true },
    ];
  }
  return { inr, methods, realRazorpay, realPaypal, chargeDemo, receiptLines };
})();
