/* SeatSwap auth — Google only (docs/08). Real Google Identity Services
   activates when SeatSwapConfig.googleClientId is set; until then a
   clearly-labeled demo sign-in stands in (same profile shape: first name +
   last initial). Asked only when the user first sends or accepts. */
const SeatSwapAuth = (() => {
  const C = (typeof SeatSwapConfig !== 'undefined' ? SeatSwapConfig : {});
  function realGoogle() { return !!(C.googleClientId && !C.demo); }

  function displayName() {
    const m = SeatSwapEngine.me();
    return m ? m.first_name : '';
  }
  function requireAuth(next) {
    if (SeatSwapEngine.authed()) {
      location.hash = next;
      return true;
    }
    sessionStorage.setItem('seatswap_after_login', next);
    location.hash = '#/signin';
    return false;
  }
  function afterLogin() {
    const next = sessionStorage.getItem('seatswap_after_login') || '#/';
    sessionStorage.removeItem('seatswap_after_login');
    location.hash = next;
  }
  function signInDemo(firstName) {
    const name = String(firstName || '').trim().split(/\s+/);
    if (!name[0]) throw new Error('name_required');
    const u = SeatSwapEngine.signIn({ first_name: name[0], last_initial: (name[1] || name[0][1] || '').slice(0, 1).toUpperCase(), via: 'demo' });
    SeatSwapEngine.notify(SeatSwapEngine.db(), u.id, 'welcome', 'Signed in', 'Your trips are now linked to your account.', '#/');
    afterLogin();
    return u;
  }
  function initGoogleButton(el, onSuccess) {
    // Real GIS wiring lands with a client ID; the button below swaps in.
    if (!realGoogle() || typeof google === 'undefined') return false;
    try {
      google.accounts.id.initialize({ client_id: C.googleClientId, callback: onSuccess });
      google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 300 });
      return true;
    } catch { return false; }
  }
  return { realGoogle, displayName, requireAuth, afterLogin, signInDemo, initGoogleButton };
})();
