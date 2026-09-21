/* Train layout knowledge (server-side). Confidence labels per spec:
   verified | expected | user-confirmed | illustrative. Never show an
   unknown seat as available; low confidence asks the user to confirm. */

/* Indian Railways 3-tier bay numbering (Sleeper / AC 3 Tier):
   per 8-berth bay: n+0 LB, n+1 MB, n+2 UB, n+3 LB, n+4 MB, n+5 UB, n+6 SL, n+7 SU
   (berth 19 in a 17-24 bay is UPPER). */
function berthType3T(n) {
  const t = ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'][(n - 1) % 8];
  return t;
}
const TYPE_LABEL = { LB: 'Lower', MB: 'Middle', UB: 'Upper', SL: 'Side Lower', SU: 'Side Upper' };

const CLASS_INFO = {
  SL: { label: 'Sleeper', layout: 'ir-3tier', confidence: 'expected', berthsPerCoach: 72 },
  '3A': { label: 'AC 3 Tier', layout: 'ir-3tier', confidence: 'expected', berthsPerCoach: 64 },
  '2A': { label: 'AC 2 Tier', layout: 'ir-2tier', confidence: 'illustrative', berthsPerCoach: 48 },
  '1A': { label: 'AC First', layout: 'ir-1tier', confidence: 'illustrative', berthsPerCoach: 24 },
};

function resolveLayout(classCode) {
  const c = CLASS_INFO[classCode];
  if (!c) return { confidence: 'illustrative', layout: null, source: 'no layout data for this class - ask the user to confirm' };
  return { confidence: c.confidence, layout: c.layout, berthsPerCoach: c.berthsPerCoach, source: 'Indian Railways standard ' + c.label + ' coach composition (' + c.confidence + ')' };
}

function berthType(classCode, berth) {
  const n = Number(berth);
  if (!Number.isInteger(n) || n < 1) return null;
  const info = CLASS_INFO[classCode];
  if (!info || info.layout !== 'ir-3tier') return null;
  return berthType3T(n);
}

module.exports = { resolveLayout, berthType, TYPE_LABEL, CLASS_INFO };
