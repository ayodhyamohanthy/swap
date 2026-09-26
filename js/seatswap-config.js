/* SeatSwap runtime config.
   Demo defaults run the full product end-to-end on-device (matching,
   payments, chat, credits, admin). For production: add real keys, set
   demo:false, and point auth/payments at the Supabase + server backend
   (docs/06-PAYMENTS.md, docs/08-PWA-AND-TECH.md). */
const SeatSwapConfig = {
  demo: true,            // on-device demo world (seeded travelers, demo bank)
  demoAuth: true,        // allow clearly-labeled demo sign-in until Google is wired
  googleClientId: '',    // paste Google OAuth client ID -> real Google button appears
  razorpayKeyId: '',     // public key -> real Razorpay Checkout (needs server order fn)
  paypalClientId: '',    // -> real PayPal buttons (needs server capture fn)
  vapidPublicKey: '',    // -> real web push (needs server + subscriptions table)
  supportContact: '',    // optional help link shown on Help screen
  PRICE_PAISE: 9900,     // ₹99 per swap
  FEE_PAISE: 4900,       // ₹49 SeatSwap fee
  CREDIT_PAISE: 5000,    // ₹50 thank-you credit to acceptor
  GROUP_PRICE_PAISE: 19900, // ₹199 group trip (up to 3 swaps)
  CREDIT_MONTHS: 12,
  MAX_OUT_PER_DAY: 10,
  BACKOUT_HIDE_AFTER: 3, // back-outs in 30d -> hidden from matches 30d
};
