/* SwapSeat server-side pricing — the ONLY place money amounts live.
   Founder-locked rules (2026-09-21, iMessage):
   - Both searching: each paid the search activation; no completion fee, no reward.
   - Only requester searching: requester pays search + completion; 50% of the
     completion fee lands in the accepter's credit wallet (redeemable on future searches).
   - Max any requester ever pays: search + completion, disclosed UPFRONT.
   - PPP for global: per-market price books, explicit and versioned — never FX-converted.
   Everything here is config-driven: amounts are constants you can flip, never hardcoded
   into business logic. Production charges stay disabled until owner approval. */

const PRICING_VERSION = 'pricing-2026-09-21.1';

/* Per-market price books (PPP). Amounts in the currency's minor unit (paise/cents).
   rewardBps: accepter reward as basis points of the completion fee (5000 = 50.00%). */
const PRICE_BOOKS = {
  IN: {
    market: 'IN',
    currency: 'INR',
    searchActivationMinor: 4900,   // Rs 49
    completionFeeMinor: 9900,      // Rs 99 (requester-only, one-sided case)
    rewardBps: 5000,               // 50% -> Rs 49.50 to accepter credits
    taxInclusive: true,            // founder to confirm; display treats prices as inclusive
  },
  US: {
    market: 'US',
    currency: 'USD',
    searchActivationMinor: 99,     // $0.99 PPP book (placeholder pending owner price book)
    completionFeeMinor: 199,       // $1.99
    rewardBps: 5000,
    taxInclusive: false,
  },
};

const FLAGS = {
  productionCharges: false,        // spec: do not activate production charges until owner confirms
  paymentsProvider: 'sandbox',     // 'sandbox' | 'razorpay' — only sandbox works until credentials arrive
  paidActivationEnabled: true,     // master switch for charging at all (sandbox included)
};

function book(market) {
  const b = PRICE_BOOKS[market];
  if (!b) throw new Error('unsupported market: ' + market);
  return b;
}

function rewardMinorFor(completionMinor, b) {
  return Math.round((completionMinor * b.rewardBps) / 10000);
}

/* What a requester could ever pay for one service activation, in minor units. */
function maxRequesterTotalMinor(market) {
  const b = book(market);
  return b.searchActivationMinor + b.completionFeeMinor;
}

/* Quote for activating search on one canonical service. Immutable once issued. */
function searchActivationQuote({ market, serviceKey, journeyId, userId }) {
  const b = book(market);
  return {
    kind: 'search_activation',
    pricingVersion: PRICING_VERSION,
    market: b.market,
    currency: b.currency,
    serviceKey,
    journeyId,
    userId,
    amountMinor: b.searchActivationMinor,
    conditionalCompletionFeeMinor: b.completionFeeMinor,
    maxTotalMinor: b.searchActivationMinor + b.completionFeeMinor,
    rewardBps: b.rewardBps,
    taxInclusive: b.taxInclusive,
  };
}

/* One-sided completion quote (requester pays when accepter has no qualifying
   activation). entitlementSnapshot freezes the eligibility decision. */
function completionQuote({ market, requestId, userId, entitlementSnapshot }) {
  const b = book(market);
  const accepterEntitled = !!(entitlementSnapshot && entitlementSnapshot.accepterEntitled);
  if (accepterEntitled) {
    return {
      kind: 'completion', pricingVersion: PRICING_VERSION, market: b.market, currency: b.currency,
      requestId, userId, amountMinor: 0, waived: true,
      rewardMinor: 0, rewardBps: b.rewardBps,
      note: 'both participants held qualifying activations: no completion fee, no reward',
    };
  }
  return {
    kind: 'completion', pricingVersion: PRICING_VERSION, market: b.market, currency: b.currency,
    requestId, userId, amountMinor: b.completionFeeMinor, waived: false,
    rewardMinor: rewardMinorFor(b.completionFeeMinor, b),
    rewardBps: b.rewardBps,
    rewardPayee: 'accepter',
    note: 'requester completion fee; 50% becomes accepter credit after verified completion',
  };
}

/* Upfront disclosure block the UI must render before collecting anything. */
function disclosure(market) {
  const b = book(market);
  const max = b.searchActivationMinor + b.completionFeeMinor;
  return {
    currency: b.currency,
    searchFeeMinor: b.searchActivationMinor,
    conditionalCompletionMinor: b.completionFeeMinor,
    maxTotalMinor: max,
    rewardBps: b.rewardBps,
    rewardMinor: rewardMinorFor(b.completionFeeMinor, b),
    points: [
      'Search fee activates matching for this journey only.',
      'If your accepter was not searching, you pay the completion fee when they accept.',
      'You will never pay more than the maximum shown.',
      'The accepter is never charged to accept.',
      'A match is not guaranteed; no-match resolution follows the market policy at the matching deadline.',
      'SwapSeat coordinates exchanges; it does not change your railway reservation.',
    ],
  };
}

function productionBlocked() {
  return !FLAGS.productionCharges;
}

module.exports = {
  PRICING_VERSION, PRICE_BOOKS, FLAGS,
  book, rewardMinorFor, maxRequesterTotalMinor,
  searchActivationQuote, completionQuote, disclosure, productionBlocked,
};
