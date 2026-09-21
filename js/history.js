/* SwapSeat · History (the local swap ledger, surfaced in the mobile flow).
   Every attempted and completed swap is written by js/ledger.js; this screen
   makes it reviewable: timestamp, service, seats, status, plus re-open/retry
   and an explicit "erase everything on this device" action. */
(() => {
  if (typeof Flow === 'undefined' || typeof SwapLedger === 'undefined') return;
  const esc = Flow.esc;

  const STATUS_LABEL = {
    draft: 'Draft', pending: 'Pending', accepted: 'Accepted',
    declined: 'Declined', expired: 'Expired', failed: 'Failed',
  };
  const stamp = (iso) => {
    try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return String(iso || ''); }
  };

  Flow.register({
    id: 'history', title: 'History',
    render() {
      SwapLedger.syncFromLegacy();
      const rows = SwapLedger.all();
      const s = SwapLedger.stats();
      const item = (r) => `
        <div class="fcard" role="group" aria-label="Swap ${esc(r.status)} on ${esc(r.serviceNumber)}">
          <div class="frow frow--line">
            <b>${esc(r.serviceNumber)}</b>
            <span class="fpill" data-status="${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>
          </div>
          <p class="fmuted">${r.mode === 'flight' ? '✈️' : r.mode === 'bus' ? '🚌' : '🚂'} ${esc(r.travelDate)} · ${esc(r.coachOrCabin)} · ${esc(r.ownSeat)} ⇄ ${esc(r.targetSeat)}</p>
          <p class="fine">${esc(stamp(r.createdAt))}${r.quoteSummary ? ' · ' + esc(r.quoteSummary) : ''}${r.failureReason ? ' · ' + esc(r.failureReason) : ''}</p>
          <div class="frow">
            ${(r.status === 'pending' || r.status === 'draft') ? `<button type="button" class="fbtn ghost" data-retry="${esc(r.id)}">Re-open</button>` : ''}
            ${r.status === 'failed' ? `<button type="button" class="fbtn ghost" data-retry="${esc(r.id)}">Retry</button>` : ''}
            <button type="button" class="fbtn ghost" data-copy="${esc(r.id)}">Copy details</button>
          </div>
        </div>`;
      return `
      ${Flow.screenHead('On this device', 'History', 'Your local swap ledger — never uploaded.')}
      <div class="fs-body">
        <div class="fcard fcard--ghost">
          <div class="frow frow--line"><span>Records</span><b>${s.total}</b></div>
          <div class="frow frow--line"><span>Pending</span><b>${s.pending}</b></div>
          <div class="frow frow--line"><span>Accepted</span><b>${s.accepted}</b></div>
          <div class="frow frow--line"><span>Failed</span><b>${s.failed}</b></div>
          <p class="fine">Schema v${SwapLedger.SCHEMA_VERSION} · stored in this browser only.</p>
        </div>
        ${rows.length ? rows.map(item).join('') : `
        <div class="fcard state-block"><span class="sb-icon" aria-hidden="true">🧾</span>
          <p class="fmuted">No swap activity yet. Requests you send or receive appear here with their status.</p>
          <button type="button" class="fbtn block" data-go-scr="home">Start a swap</button></div>`}
        <div class="fs-actions">
          <button type="button" class="fbtn ghost block" id="lgExport">Export ledger (JSON)</button>
          <button type="button" class="fbtn ghost block" id="lgClear">Erase all local data</button>
        </div>
        <p class="safe-note">Erasing removes your ledger, saved journey, preferences, wallet and chat threads from this browser. It cannot be undone, and it is what a sign-out does on a shared device.</p>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.goScr)));
      root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
        const rec = SwapLedger.all().find((r) => r.id === b.dataset.retry);
        if (!rec) return;
        Flow.ctx.mode = rec.mode;
        toast('Re-opened — pick your seats to send a fresh request.');
        Flow.show('seats');
      }));
      root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
        const rec = SwapLedger.all().find((r) => r.id === b.dataset.copy);
        if (!rec) return;
        const text = `${rec.serviceNumber} · ${rec.travelDate} · ${rec.coachOrCabin} · ${rec.ownSeat} ⇄ ${rec.targetSeat} · ${rec.status}`;
        try { await navigator.clipboard.writeText(text); toast('Ledger entry copied.'); }
        catch { toast(text); }
      }));
      root.querySelector('#lgExport').addEventListener('click', () => {
        const blob = new Blob([SwapLedger.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'swapseat-ledger.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Ledger exported.');
      });
      root.querySelector('#lgClear').addEventListener('click', () => {
        const n = SwapLedger.clear();
        toast(`Erased ${n} record${n === 1 ? '' : 's'} and all local SwapSeat data.`);
        Flow.show('history');
      });
    },
  });
})();
