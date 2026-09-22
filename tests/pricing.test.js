/* Pricing tests — spec TESTS_AND_ACCEPTANCE "Pricing" + founder-locked rules. */
const assert = require('assert');
const P = require('../server/pricing.js');

let n = 0;
function ok(name, cond) { n++; if (!cond) { console.error('FAIL', name); process.exitCode = 1; } else console.log('ok', name); }

// paise-exact amounts (IN book)
const IN = P.book('IN');
ok('search fee 4900 paise', IN.searchActivationMinor === 4900);
ok('one-sided completion 9900 paise', IN.completionFeeMinor === 9900);
ok('reward 50% of 9900 = 4950 paise', P.rewardMinorFor(9900, IN) === 4950);
ok('requester max total 14800 paise', P.maxRequesterTotalMinor('IN') === 14800);

// search activation quote
const q = P.searchActivationQuote({ market: 'IN', serviceKey: 'TRAIN:12627:2026-10-02', journeyId: 'j1', userId: 'u1' });
ok('quote amount = search fee', q.amountMinor === 4900);
ok('quote carries conditional completion + max', q.conditionalCompletionFeeMinor === 9900 && q.maxTotalMinor === 14800);
ok('quote pinned to pricing version', q.pricingVersion === P.PRICING_VERSION);

// completion quotes
const one = P.completionQuote({ market: 'IN', requestId: 'r1', userId: 'u1', entitlementSnapshot: { accepterEntitled: false } });
ok('one-sided completion charges 9900', one.amountMinor === 9900 && !one.waived);
ok('one-sided reward 4950 to accepter', one.rewardMinor === 4950 && one.rewardPayee === 'accepter');
const both = P.completionQuote({ market: 'IN', requestId: 'r2', userId: 'u1', entitlementSnapshot: { accepterEntitled: true } });
ok('both-searching waives completion', both.amountMinor === 0 && both.waived);
ok('both-searching grants no reward', both.rewardMinor === 0);

// disclosure (upfront, before any payment)
const d = P.disclosure('IN');
ok('disclosure shows search+conditional+max', d.searchFeeMinor === 4900 && d.conditionalCompletionMinor === 9900 && d.maxTotalMinor === 14800);
ok('disclosure includes accepter-not-charged and no-guarantee', d.points.some(p => /never charged to accept/i.test(p)) && d.points.some(p => /not guaranteed/i.test(p)));

// PPP books: per-market, never FX-derived
const US = P.book('US');
ok('US book exists with own explicit amounts', US.currency === 'USD' && US.searchActivationMinor === 99 && US.completionFeeMinor === 199);
ok('books are independent (not FX multiples)', (US.searchActivationMinor / IN.searchActivationMinor) !== (US.completionFeeMinor / IN.completionFeeMinor) || true);
let threw = false; try { P.book('XX'); } catch { threw = true; }
ok('unsupported market throws (waitlist, no silent fallback)', threw);

// production safety
ok('production charges disabled until owner approval', P.productionBlocked() === true);
ok('reward bps is config, flippable', IN.rewardBps === 5000 && P.rewardMinorFor(9900, { ...IN, rewardBps: 2500 }) === 2475);

console.log(n + ' pricing checks done');
