/* SwapSeat · real exchange screens (M3) - train requester flow.
   Server-backed: journeys, own map, preferences, protected matches,
   activation checkout (sandbox until owner approves live charges), request.
   Money/eligibility/privacy decisions come from the server API; these views
   only render what the server decided. */
(() => {
  if (typeof Flow === 'undefined' || typeof Auth === 'undefined') return;
  const esc = Flow.esc;

  const money = (minor, cur) => {
    const v = (minor / 100).toFixed(minor % 100 ? 2 : 0);
    return (cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur + ' ') + v;
  };
  const clsLabel = { SL: 'Sleeper', '3A': 'AC 3 Tier', '2A': 'AC 2 Tier', '1A': 'AC First' };
  const TYPE_LABEL = { LB: 'Lower', MB: 'Middle', UB: 'Upper', SL: 'Side Lower', SU: 'Side Upper' };
  const steps = ['Journey', 'Seat', 'Prefs', 'Matches', 'Activate'];

  function needAuth() {
    return Flow.screenHead('Real exchange', 'Sign in first', 'One-time code, no password. Your number is never shown.') +
      `<div class="fs-body"><button type="button" class="fbtn block" data-go="login">Sign in</button></div>`;
  }
  function serverDown() {
    return Flow.screenHead('Real exchange', 'Server unavailable', 'The coordination server is not reachable. Nothing here is simulated - try again shortly.') +
      `<div class="fs-body"><button type="button" class="fbtn ghost block" data-go="home">Back home</button></div>`;
  }

  /* ---------- 1 · journey entry ---------- */
  Flow.register({
    id: 'x-journey', title: 'Your journey',
    render() {
      if (!Auth.signedIn()) return needAuth();
      if (Auth.isAvailable() === false) return serverDown();
      const j = Flow.ctx.xJourney || {};
      return `
      ${Flow.screenHead('Real exchange · train', 'Enter your journey', 'Manual entry is a real workflow. Boarding must come before destination.')}
      ${Flow.stepsBar(0, steps)}
      <div class="fs-body"><form id="xjForm" class="fcard" novalidate>
        <label class="flabel">Train number<input class="finput" id="xjTrain" inputmode="numeric" maxlength="5" placeholder="12627" value="${esc(j.trainNumber || '')}" required></label>
        <label class="flabel">Journey date<input class="finput" id="xjDate" type="date" value="${esc(j.date || '')}" required></label>
        <div class="fgrid2">
          <label class="flabel">Boarding (code)<input class="finput" id="xjFrom" maxlength="4" placeholder="SBC" value="${esc(j.boarding || '')}" required></label>
          <label class="flabel">Stop #<input class="finput" id="xjFromIdx" inputmode="numeric" maxlength="2" placeholder="1" value="${esc(j.boardingIndex ?? 1)}" required></label>
        </div>
        <div class="fgrid2">
          <label class="flabel">Destination (code)<input class="finput" id="xjTo" maxlength="4" placeholder="NDLS" value="${esc(j.destination || '')}" required></label>
          <label class="flabel">Stop #<input class="finput" id="xjToIdx" inputmode="numeric" maxlength="2" placeholder="10" value="${esc(j.destinationIndex ?? '')}" required></label>
        </div>
        <div class="fgrid2">
          <label class="flabel">Class<select class="finput" id="xjClass">
            ${['SL', '3A', '2A', '1A'].map(c => `<option ${j.classCode === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select></label>
          <label class="flabel">Coach<input class="finput" id="xjCoach" maxlength="4" placeholder="S4" value="${esc(j.coach || '')}" required></label>
        </div>
        <label class="flabel">Berth number<input class="finput" id="xjBerth" inputmode="numeric" maxlength="3" placeholder="19" value="${esc(j.berth || '')}" required></label>
        <p class="fmuted" id="xjErr" role="alert"></p>
        <button type="submit" class="fbtn block">Continue</button>
      </form></div>`;
    },
    wire(root) {
      if (!Auth.signedIn() || Auth.isAvailable() === false) return;
      root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => Flow.show(b.dataset.go)));
      const form = root.querySelector('#xjForm');
      if (!form) return;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = root.querySelector('#xjErr');
        err.textContent = '';
        const body = {
          trainNumber: root.querySelector('#xjTrain').value.trim(),
          date: root.querySelector('#xjDate').value,
          boarding: root.querySelector('#xjFrom').value.trim().toUpperCase(),
          boardingIndex: Number(root.querySelector('#xjFromIdx').value),
          destination: root.querySelector('#xjTo').value.trim().toUpperCase(),
          destinationIndex: Number(root.querySelector('#xjToIdx').value),
          classCode: root.querySelector('#xjClass').value,
          coach: root.querySelector('#xjCoach').value.trim().toUpperCase(),
          berth: Number(root.querySelector('#xjBerth').value),
        };
        try {
          const d = await Auth.api('/api/journeys', { method: 'POST', body });
          Flow.ctx.xJourney = d.journey;
          Flow.show('x-map');
        } catch (e) { err.textContent = (e && e.message) || 'Could not save journey.'; }
      });
    },
  });

  /* ---------- 2 · own seat map ---------- */
  Flow.register({
    id: 'x-map', title: 'Your seat',
    render() {
      if (!Auth.signedIn()) return needAuth();
      const j = Flow.ctx.xJourney;
      if (!j) return needJourney();
      return `
      ${Flow.screenHead('Real exchange · train', 'Confirm your seat', 'Your exact seat stays visible to you. Other travellers only see your coach and berth type.')}
      ${Flow.stepsBar(1, steps)}
      <div class="fs-body">
        <div class="fcard fcard--booking">
          <div class="frow"><b>${esc(j.coach)} · berth ${esc(j.berth)} · ${esc(TYPE_LABEL[j.berthType] || '')}</b></div>
          <p class="fmuted">${esc(j.trainNumber)} · ${esc(j.boarding)} → ${esc(j.destination)} · ${esc(clsLabel[j.classCode] || j.classCode)} · ${esc(j.date)}</p>
          <p class="fmuted">Layout confidence: <b>${esc(j.layoutConfidence)}</b> — ${esc(j.layoutSource || '')}</p>
        </div>
        ${j.layoutConfidence !== 'verified' ? `<p class="safe-note">This layout is ${esc(j.layoutConfidence)}, not operator-verified. Check your ticket; you can correct the coach or berth by going back.</p>` : ''}
        <button type="button" class="fbtn block" id="xmOk">This is my seat</button>
        <button type="button" class="fbtn ghost block" id="xmFix">Fix journey details</button>
      </div>`;
    },
    wire(root) {
      const ok = root.querySelector('#xmOk');
      if (ok) ok.addEventListener('click', () => Flow.show('x-prefs'));
      const fix = root.querySelector('#xmFix');
      if (fix) fix.addEventListener('click', () => Flow.show('x-journey'));
    },
  });

  /* ---------- 3 · preferences ---------- */
  Flow.register({
    id: 'x-prefs', title: 'Preferences',
    render() {
      if (!Auth.signedIn()) return needAuth();
      const j = Flow.ctx.xJourney;
      if (!j) return needJourney();
      const p = j.preferences || {};
      const types = ['LB', 'MB', 'UB', 'SL', 'SU'];
      return `
      ${Flow.screenHead('Real exchange · train', 'What would you take?', 'Only your accept list and coach are shared. Gender is optional and never public.')}
      ${Flow.stepsBar(2, steps)}
      <div class="fs-body"><form id="xpForm" class="fcard" novalidate>
        <div class="flabel">Berth types you would accept</div>
        <div class="chips" id="xpTypes">
          ${types.map(t => `<button type="button" class="chip ${((p.acceptTypes || []).includes(t)) ? 'on' : ''}" data-t="${t}">${TYPE_LABEL[t]}</button>`).join('')}
        </div>
        <label class="flabel">Why move? (optional)<input class="finput" id="xpReason" maxlength="140" placeholder="e.g. elderly parent needs a lower berth" value="${esc(p.reason || '')}"></label>
        <label class="flabel">Display name (optional)<input class="finput" id="xpName" maxlength="60" placeholder="Shown masked, like Priya S." value="${esc(p.displayName || '')}"></label>
        <label class="flabel">Gender preference (optional)<select class="finput" id="xpGpref">
          <option value="no-preference" ${p.genderPref === 'no-preference' ? 'selected' : ''}>No preference</option>
          <option value="same-gender" ${p.genderPref === 'same-gender' ? 'selected' : ''}>Same gender</option>
          <option value="prefer-not-to-say" ${p.genderPref === 'prefer-not-to-say' ? 'selected' : ''}>Prefer not to say</option>
        </select></label>
        <label class="flabel">Your gender (optional, never shown)<select class="finput" id="xpGender">
          <option value="" ${!p.gender ? 'selected' : ''}>Not shared</option>
          <option value="female" ${p.gender === 'female' ? 'selected' : ''}>Female</option>
          <option value="male" ${p.gender === 'male' ? 'selected' : ''}>Male</option>
          <option value="other" ${p.gender === 'other' ? 'selected' : ''}>Other</option>
          <option value="prefer-not-to-say" ${p.gender === 'prefer-not-to-say' ? 'selected' : ''}>Prefer not to say</option>
        </select></label>
        <p class="fmuted" id="xpErr" role="alert"></p>
        <button type="submit" class="fbtn block">See matches</button>
      </form></div>`;
    },
    wire(root) {
      if (!Auth.signedIn()) return;
      const picked = new Set((Flow.ctx.xJourney.preferences || {}).acceptTypes || []);
      root.querySelectorAll('#xpTypes .chip').forEach(ch => ch.addEventListener('click', () => {
        const t = ch.dataset.t;
        if (picked.has(t)) { picked.delete(t); ch.classList.remove('on'); } else { picked.add(t); ch.classList.add('on'); }
      }));
      const form = root.querySelector('#xpForm');
      if (!form) return;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = root.querySelector('#xpErr');
        err.textContent = '';
        const j = Flow.ctx.xJourney;
        try {
          const d = await Auth.api('/api/journeys/' + j.id + '/preferences', { method: 'PUT', body: {
            acceptTypes: [...picked],
            reason: root.querySelector('#xpReason').value.trim(),
            displayName: root.querySelector('#xpName').value.trim(),
            genderPref: root.querySelector('#xpGpref').value,
            gender: root.querySelector('#xpGender').value || undefined,
          } });
          Flow.ctx.xJourney = d.journey;
          Flow.show('x-matches');
        } catch (e) { err.textContent = (e && e.message) || 'Could not save preferences.'; }
      });
    },
  });

  function needJourney() {
    return Flow.screenHead('Real exchange', 'Start with your journey', 'Enter the journey first so matches stay on your exact train and segment.') +
      `<div class="fs-body"><button type="button" class="fbtn block" data-go="x-journey">Enter journey</button></div>`;
  }

  /* ---------- 4 · protected matches ---------- */
  Flow.register({
    id: 'x-matches', title: 'Matches',
    render() {
      if (!Auth.signedIn()) return needAuth();
      const j = Flow.ctx.xJourney;
      if (!j) return needJourney();
      const cands = Flow.ctx.xCandidates;
      const body = cands == null
        ? `<p class="fmuted">Checking your train…</p>`
        : cands.length === 0
          ? `<div class="fcard fcard--ghost"><div class="frow"><b>No compatible travellers yet</b></div>
             <p class="fmuted">Matching runs until the deadline for this journey. An empty list right now is not a no-match outcome.</p></div>`
          : cands.map((c, i) => `
          <div class="fcard">
            <div class="frow"><b>${esc(c.maskedName)}</b><span class="xp-searching">${c.searching ? 'also searching' : 'open to offers'}</span></div>
            <p class="fmuted">Coach ${esc(c.coarseRegion.coach)} · ${esc(c.coarseRegion.berthTypeLabel || '')} berth</p>
            <div class="xp-fit"><div class="xp-fitbar" style="width:${c.fit.pct}%"></div></div>
            <p class="fmuted">Preference fit ${c.fit.pct}/${c.fit.denominator} <button type="button" class="xp-why" data-why="${i}">why?</button></p>
            <div class="xp-whylist" id="why-${i}" hidden>
              ${c.fit.factors.map(f => `<p class="fmuted">${f.matched ? '✅' : '➖'} ${esc(f.label)} <span class="xp-w">+${f.weight}</span></p>`).join('')}
              <p class="fmuted">Fit compares preferences only - it is not a chance the swap happens.</p>
            </div>
            <button type="button" class="fbtn block" data-req="${esc(c.candidateId)}">Request this swap</button>
          </div>`).join('');
      return `
      ${Flow.screenHead('Real exchange · train', 'Compatible travellers', 'Exact seats stay hidden until you both agree and the required payment is done.')}
      ${Flow.stepsBar(3, steps)}
      <div class="fs-body">
        <p class="safe-note">🔒 Seat numbers are never shown here. Coordinates and booking references stay on the server.</p>
        ${body}
      </div>`;
    },
    async wire(root) {
      if (!Auth.signedIn()) return;
      root.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', () => {
        const el = root.querySelector('#why-' + b.dataset.why);
        if (el) el.hidden = !el.hidden;
      }));
      const j = Flow.ctx.xJourney;
      if (Flow.ctx.xCandidates == null) {
        try {
          const d = await Auth.api('/api/journeys/' + j.id + '/matches');
          Flow.ctx.xCandidates = d.candidates;
          Flow.show('x-matches');
        } catch (_) { Flow.ctx.xCandidates = []; Flow.show('x-matches'); }
        return;
      }
      root.querySelectorAll('[data-req]').forEach(btn => btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const d = await Auth.api('/api/exchange-requests', { method: 'POST', body: { journeyId: j.id, candidateId: btn.dataset.req } });
          Flow.ctx.xRequest = d.request;
          Flow.show('x-sent');
        } catch (e) {
          if (e && /activation required/i.test(e.message || '')) { Flow.ctx.xPendingCandidate = btn.dataset.req; Flow.show('x-checkout'); }
          else { btn.disabled = false; btn.textContent = 'Try again'; }
        }
      }));
    },
  });

  /* ---------- 5 · activation checkout ---------- */
  Flow.register({
    id: 'x-checkout', title: 'Activate search',
    render() {
      if (!Auth.signedIn()) return needAuth();
      const j = Flow.ctx.xJourney;
      if (!j) return needJourney();
      const q = Flow.ctx.xQuote, d = Flow.ctx.xDisclosure;
      const inner = !q
        ? `<p class="fmuted">Preparing your quote…</p>`
        : `
        <div class="fcard fcard--booking">
          <div class="frow"><b>${money(q.amountMinor, q.currency)} search activation</b><span class="xp-sandbox">SANDBOX</span></div>
          <p class="fmuted">One train, one journey: ${esc(j.trainNumber)} · ${esc(j.date)}</p>
        </div>
        <div class="fcard">
          <div class="frow"><b>Before you pay</b></div>
          ${d.points.map(p => `<p class="fmuted">• ${esc(p)}</p>`).join('')}
          <p class="frow"><b>Maximum you could ever pay on this journey: ${money(d.maxTotalMinor, d.currency)}</b></p>
          <p class="fmuted">(${money(d.searchFeeMinor, d.currency)} now${d.conditionalCompletionMinor ? ' + ' + money(d.conditionalCompletionMinor, d.currency) + ' only if your accepter was not searching' : ''}.)</p>
        </div>
        <p class="safe-note">Payments run in sandbox mode until the founder enables a live gateway. No real charge happens here, and nothing pretends otherwise.</p>
        <button type="button" class="fbtn block" id="xcPay">Pay ${money(q.amountMinor, q.currency)} (sandbox)</button>`;
      return `
      ${Flow.screenHead('Real exchange · train', 'Activate your search', 'The server sets the price and the rules. This screen only shows what it decided.')}
      ${Flow.stepsBar(4, steps)}
      <div class="fs-body">${inner}</div>`;
    },
    async wire(root) {
      if (!Auth.signedIn()) return;
      const j = Flow.ctx.xJourney;
      if (!Flow.ctx.xQuote) {
        try {
          const d = await Auth.api('/api/quotes', { method: 'POST', body: { journeyId: j.id, kind: 'search_activation', market: 'IN' } });
          Flow.ctx.xQuote = d.quote; Flow.ctx.xDisclosure = d.disclosure;
          Flow.show('x-checkout');
        } catch (e) {
          root.querySelector('.fs-body').innerHTML = `<p class="safe-note">${esc((e && e.message) || 'Checkout unavailable.')}</p>`;
        }
        return;
      }
      const pay = root.querySelector('#xcPay');
      if (pay) pay.addEventListener('click', async () => {
        pay.disabled = true;
        try {
          const p = await Auth.api('/api/payments/intents', { method: 'POST', body: { quoteId: Flow.ctx.xQuote.id, idempotencyKey: 'ui-' + Date.now() } });
          await Auth.api('/api/journeys/' + j.id + '/activate', { method: 'POST', body: { paymentId: p.payment.id } });
          Flow.ctx.xJourney = { ...Flow.ctx.xJourney, state: 'searching' };
          const cand = Flow.ctx.xPendingCandidate;
          if (cand) {
            const d = await Auth.api('/api/exchange-requests', { method: 'POST', body: { journeyId: j.id, candidateId: cand } });
            Flow.ctx.xRequest = d.request;
            Flow.show('x-sent');
          } else {
            Flow.show('x-matches');
          }
        } catch (e) {
          pay.disabled = false; pay.textContent = 'Payment failed - try again';
        }
      });
    },
  });

  /* ---------- 6 · request sent ---------- */
  Flow.register({
    id: 'x-sent', title: 'Request sent',
    render() {
      const r = Flow.ctx.xRequest || {};
      return `
      ${Flow.screenHead('Real exchange · train', 'Request sent', '')}
      <div class="fs-body">
        <div class="fcard fcard--booking">
          <div class="frow"><b>To ${esc(r.counterpart || 'traveller')} · ${esc(r.state || 'pending')}</b></div>
          <p class="fmuted">They are never charged to accept. If they were not searching and they accept, you pay the completion fee, and half of it becomes their SwapSeat credit after a verified completion.</p>
          <p class="fmuted">Exact seats reveal only after you both agree and the required payment is done. The crew always decides on board.</p>
        </div>
        <button type="button" class="fbtn block" id="xsBack">Back to matches</button>
        <button type="button" class="fbtn ghost block" id="xsHome">Home</button>
      </div>`;
    },
    wire(root) {
      const b1 = root.querySelector('#xsBack');
      if (b1) b1.addEventListener('click', () => { Flow.ctx.xCandidates = null; Flow.show('x-matches'); });
      const b2 = root.querySelector('#xsHome');
      if (b2) b2.addEventListener('click', () => Flow.show('home'));
    },
  });
})();
