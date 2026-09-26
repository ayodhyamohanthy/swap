/* SeatSwap screens 3 — admin console (desktop-friendly responsive pages).
   Guarded by a local demo flag; production uses has_role() server-side
   (supabase/schema + Step 12). Every admin action writes activity_log. */
(() => {
  const H = SeatSwapApp.helpers;
  const { esc, Art, innerHead, footer, bindBack } = H;
  const T = SeatSwapApp.T;
  const E = () => SeatSwapEngine;

  function gate() {
    if (!E().isAdmin()) {
      return { tab: 'profile', html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('admin.title'))}</h1>
        <p class="subtitle">${esc(T('admin.gate'))}</p>
        <button type="button" class="btn" id="adminOn">${esc(T('admin.demoOn'))}</button>
        ${footer(false)}</main>` };
    }
    return null;
  }
  function nav() {
    const items = [['admin', T('admin.overview')], ['admin_log', T('admin.log')], ['admin_users', T('admin.users')], ['admin_swaps', T('admin.swaps')], ['admin_payments', T('admin.payments')], ['admin_credits', T('admin.credits')], ['admin_reports', T('admin.reports')]];
    return `<div class="chips">${items.map(([n, l]) => {
      const href = n === 'admin' ? '#/admin' : '#/admin/' + n.replace('admin_', '');
      return `<a class="chipbtn" href="${href}">${esc(l)}</a>`;
    }).join('')}</div>`;
  }

  SeatSwapApp.screen('admin', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const trips = SeatSwapStore.trips().length;
      const reqs = Object.keys(d.requests).length;
      const paid = Object.values(d.payments).filter((p) => p.status === 'paid').length;
      const conf = Object.values(d.requests).filter((r) => r.status === 'confirmed').length;
      const stats = [
        [trips, T('admin.s_pnrs')], [reqs, T('admin.s_requests')],
        [paid, T('admin.s_paid')], [conf, T('admin.s_confirmed')],
      ];
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.title'))}</h1>
        <p class="fine">${esc(T('admin.demoNote'))}</p>${nav()}
        <div class="statgrid">${stats.map(([v, l]) => `<div class="stat"><b>${v}</b><small>${esc(l)}</small></div>`).join('')}</div>
        <button type="button" class="linklike" id="adminOff">${esc(T('admin.demoOff'))}</button>
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      const g = el.querySelector('#adminOn');
      if (g) g.addEventListener('click', () => { E().setAdmin(true); SeatSwapApp.render(); });
      const off = el.querySelector('#adminOff');
      if (off) off.addEventListener('click', () => { E().setAdmin(false); SeatSwapApp.render(); });
    },
  });

  SeatSwapApp.screen('admin_log', {
    render(r) {
      const g = gate();
      if (g) return g;
      const list = E().activityList({ q: r.q || '' });
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.log'))}</h1>${nav()}
        <form id="logQ"><input id="logIn" class="input" value="${esc(r.q || '')}" placeholder="${esc(T('admin.searchPh'))}" /></form>
        <div class="sharerow"><button type="button" class="sharebtn" id="csvBtn">${esc(T('admin.csv'))}</button></div>
        ${list.map((a) => `<div class="adminrow"><b>${esc(a.action)}</b> · ${esc(a.actor_role)}<small>${esc(a.entity || '')} ${esc(a.entity_id || '')} · ${esc(a.created_at)}</small><small>${esc(JSON.stringify(a.meta || {}).slice(0, 180))}</small></div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      el.querySelector('#logQ').addEventListener('submit', (e) => {
        e.preventDefault();
        location.hash = '#/admin/log?q=' + encodeURIComponent(el.querySelector('#logIn').value);
      });
      el.querySelector('#csvBtn').addEventListener('click', () => {
        const rows = [['created_at', 'actor', 'role', 'action', 'entity', 'entity_id', 'meta']];
        E().activityList({}).forEach((a) => rows.push([a.created_at, a.actor || '', a.actor_role, a.action, a.entity || '', a.entity_id || '', JSON.stringify(a.meta || {})]));
        const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'activity.csv';
        a.click();
      });
    },
  });

  SeatSwapApp.screen('admin_users', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const users = Object.values(d.users);
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.users'))}</h1>${nav()}
        ${users.map((u) => `<div class="adminrow"><b>${esc(u.first_name)} ${esc(u.last_initial)}.</b> · ${esc(u.authed)}
          <small>${esc(u.id)} · credit ${esc(String(E().balance(d, u.id) / 100))} · backouts ${esc(String(E().backedOut30d(u.id)))}</small>
          <div class="arow"><button type="button" class="minibtn" data-adj="${u.id}">${esc(T('admin.adjust'))}</button></div></div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      el.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => {
        const amt = Number(window.prompt(T('admin.adjustAmt'), '50'));
        if (!amt) return;
        const reason = window.prompt(T('admin.adjustReason'), '') || '';
        E().adminAdjust(b.dataset.adj, Math.round(amt * 100), reason);
        SeatSwapApp.render();
      }));
    },
  });

  SeatSwapApp.screen('admin_swaps', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const reqs = Object.values(d.requests).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.swaps'))}</h1>${nav()}
        ${reqs.map((r) => `<div class="adminrow"><b>${esc(r.id.slice(0, 10))}</b> · ${esc(r.status)}
          <small>${esc(r.choices.join('/'))} · ${esc(r.created_at)}</small>
          <div class="arow">
            ${r.status === 'disputed' ? `<button type="button" class="minibtn minibtn--go" data-res="confirmed" data-r="${r.id}">${esc(T('admin.toConfirmed'))}</button>
            <button type="button" class="minibtn minibtn--red" data-res="voided" data-r="${r.id}">${esc(T('admin.toVoided'))}</button>` : ''}
            ${['locked', 'disputed', 'accepted_awaiting_payment'].includes(r.status) ? `<button type="button" class="minibtn" data-mc="${r.id}">${esc(T('admin.moveCredit'))}</button>
            <button type="button" class="minibtn" data-md="${r.id}">${esc(T('admin.markDone'))}</button>` : ''}
          </div></div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      el.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => {
        E().resolveDispute(b.dataset.r, E().meId(), b.dataset.res, '');
        SeatSwapApp.render();
      }));
      el.querySelectorAll('[data-mc]').forEach((b) => b.addEventListener('click', () => { E().moveToCredit(b.dataset.mc, E().meId()); SeatSwapApp.render(); }));
      el.querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', () => { E().markDone(b.dataset.md, E().meId()); SeatSwapApp.render(); }));
    },
  });

  SeatSwapApp.screen('admin_payments', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const ps = Object.values(d.payments).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.payments'))}</h1>${nav()}
        ${ps.map((p) => `<div class="adminrow"><b>${esc(p.provider)}</b> · ${esc(p.status)} · ₹${esc(String(p.amount_paise / 100))}
          <small>credit used ₹${esc(String(p.credit_used_paise / 100))} · ref ${esc(p.provider_ref || '—')} · ${esc(p.created_at)}</small></div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  SeatSwapApp.screen('admin_credits', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const tx = d.wallet.slice().reverse().slice(0, 100);
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.credits'))}</h1>${nav()}
        ${tx.map((w) => `<div class="adminrow"><b>${w.amount_paise > 0 ? '+' : ''}₹${esc(String(w.amount_paise / 100))}</b> · ${esc(w.kind)}
          <small>${esc(w.user_id)} · expires ${esc(String(w.expires_at).slice(0, 10))} · ${esc(w.created_at)}</small></div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  SeatSwapApp.screen('admin_reports', {
    render() {
      const g = gate();
      if (g) return g;
      const d = E().db();
      const reps = Object.values(d.reports).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return {
        tab: 'profile',
        html: `${innerHead()}<main class="body"><h1 class="h-title">${esc(T('admin.reports'))}</h1>${nav()}
        ${reps.map((x) => `<div class="adminrow"><b>${esc(x.status)}</b> · ${esc(x.reason || '—')}
          <small>${esc(x.reporter_id)} → ${esc(x.reported_id)} · ${esc(x.created_at)}</small>
          ${x.status === 'open' ? `<div class="arow"><button type="button" class="minibtn" data-close="${x.id}">${esc(T('admin.close'))}</button></div>` : ''}</div>`).join('') || `<p class="subtitle">${esc(T('admin.empty'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { E().closeReport(b.dataset.close, E().meId(), false); SeatSwapApp.render(); }));
    },
  });
})();
