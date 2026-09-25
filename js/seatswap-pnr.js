/* SeatSwap PNR utils — Step 2 (Trips).
   - Indian trains only. Classes: 1A,2A,3A,3E,SL,CC,EC,2S.
   - Berth types: LB,MB,UB,SL,SU (sleeper) + WINDOW,AISLE,MIDDLE_SEAT (chair car).
   - Ticket statuses: CNF,RAC,WL,CAN. Quotas: GN,SS,LD,HP,TQ,PT,OTHER.
   - Never store full PNR in plain text: only pnr_hash (SHA-256 + salt) + pnr_last4.
   - Parse is local-only (regex over typed digits or pasted IRCTC SMS).
   Money: integer paise (₹99 = 9900) — see store. */
const SeatSwapPNR = (() => {
  const CLASSES = ['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC', '2S'];
  const CHAIR = new Set(['CC', 'EC', '2S']);
  const SALT = 'seatswap-v1';

  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
  function validPNR(pnr) { return /^[0-9]{10}$/.test(digitsOnly(pnr)); }
  function last4(pnr) { return digitsOnly(pnr).slice(-4); }
  function mask(pnr) {
    const d = digitsOnly(pnr);
    return d.length <= 4 ? '••••' : '••••••' + d.slice(-4);
  }
  async function hash(pnr) {
    const msg = SALT + ':' + digitsOnly(pnr);
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      let h1 = 0x811c9dc5, h2 = 0x01000193;
      for (let i = 0; i < msg.length; i++) {
        h1 = Math.imul(h1 ^ msg.charCodeAt(i), 16777619) >>> 0;
        h2 = Math.imul(h2 + msg.charCodeAt(i), 31) >>> 0;
      }
      return 'f1-' + h1.toString(16) + h2.toString(16);
    }
  }

  /* Parse a pasted IRCTC booking SMS locally. Real SMS formats vary; we extract
     what we can and leave the rest for the user to confirm. Never sent anywhere. */
  function parseSMS(sms) {
    const s = String(sms || '').toUpperCase();
    const out = {};
    const pnr = (s.match(/PNR\s*[:#]?\s*(\d{10})/) || s.match(/\b(\d{10})\b/));
    if (pnr) out.pnr = pnr[1];
    const trn = s.match(/(?:TRN|TRAIN|TR)\s*[:#]?\s*(\d{3,5})/);
    if (trn) out.train_no = trn[1];
    const doj =
      s.match(/DOJ\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/) ||
      s.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
    if (doj) out.journey_date = normDate(doj[1]);
    const cls = s.match(/\b(1A|2A|3A|3E|SL|CC|EC|2S)\b/);
    if (cls) out.class = cls[1];
    const coach = s.match(/\b([ABE]\d{1,2}|C\d{1,2}|S\d{1,2}|B\d{1,2}|H\d|A\d{1,2})\b/);
    if (coach) out.coach = coach[1];
    const berth = s.match(/\b(\d{1,3})\s*(LB|MB|UB|SL|SU|LOWER|MIDDLE|UPPER|SIDE)\b/);
    if (berth) {
      out.berth_no = berth[1];
      out.berth_type = normBerth(berth[2], out.class);
    } else {
      const seat = s.match(/\b(WINDOW|AISLE|MIDDLE)\b/);
      if (seat) out.berth_type = seat[1] === 'WINDOW' ? 'WINDOW' : seat[1] === 'AISLE' ? 'AISLE' : 'MIDDLE_SEAT';
    }
    const st = s.match(/\b(CNF|CONFIRM|RAC|WL\d*|WAITLIST|CAN|CANCELLED)\b/);
    if (st) out.status = normStatus(st[1]);
    const route = s.match(/\b([A-Z]{3,4})\s*(?:TO|->|→)\s*([A-Z]{3,4})\b/);
    if (route) { out.from_code = route[1]; out.to_code = route[2]; }
    const q = s.match(/\b(SS|LD|HP|TQ|GN|PT)\b/);
    if (q) out.quota = q[1];
    return out;
  }

  function normDate(d) {
    const m = String(d).match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return null;
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  function normBerth(b, cls) {
    const v = String(b).toUpperCase();
    if (v.startsWith('LOW')) return 'LB';
    if (v.startsWith('MID')) return 'MB';
    if (v.startsWith('UPP')) return 'UB';
    if (['LB', 'MB', 'UB', 'SL', 'SU'].includes(v)) return v;
    if (isChair(cls)) return 'WINDOW';
    return 'LB';
  }
  function normStatus(s) {
    const v = String(s).toUpperCase();
    if (v.startsWith('CNF') || v.startsWith('CONFIRM')) return 'CNF';
    if (v.startsWith('RAC')) return 'CNF';
    if (v.startsWith('WL') || v.startsWith('WAIT')) return 'WL';
    if (v.startsWith('CAN')) return 'CAN';
    return 'CNF';
  }
  function isChair(cls) { return CHAIR.has(String(cls || '').toUpperCase()); }
  function berthLabel(type, cls) {
    if (isChair(cls)) {
      return type === 'AISLE' ? 'Aisle' : type === 'MIDDLE_SEAT' ? 'Middle' : 'Window';
    }
    return type === 'LB' ? 'Lower' : type === 'MB' ? 'Middle' : type === 'UB' ? 'Upper'
      : type === 'SL' ? 'Side Lower' : type === 'SU' ? 'Side Upper' : String(type);
  }
  function quotaNote(quota) {
    return quota === 'SS' || quota === 'LD' || quota === 'HP';
  }
  return {
    CLASSES, validPNR, digitsOnly, last4, mask, hash,
    parseSMS, normDate, isChair, berthLabel, quotaNote, normStatus,
  };
})();
