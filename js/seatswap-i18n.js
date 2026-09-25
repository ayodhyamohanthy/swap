/* SeatSwap i18n — Steps 1-2 foundation.
   Copy lives in /locales/{lang}.json. English + Hindi at launch;
   structure ready for all 22 scheduled languages (add locales/xx.json + LANGS).
   No banned words in locale files except the single required footer disclaimer. */
const SeatSwapI18n = (() => {
  const KEY = 'seatswap_lang_v1';
  const LANGS = ['en', 'hi'];
  let cache = {};
  let lang = 'en';
  try { lang = localStorage.getItem(KEY) || 'en'; } catch { lang = 'en'; }
  if (!LANGS.includes(lang)) lang = 'en';

  async function load(l) {
    if (cache[l]) return cache[l];
    const res = await fetch('./locales/' + l + '.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error('locale ' + l + ' missing');
    cache[l] = await res.json();
    return cache[l];
  }
  function get(obj, path) {
    return path.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);
  }
  function tmpl(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
  }
  let en = null, cur = null;
  async function init() {
    en = await load('en');
    cur = lang === 'en' ? en : await load(lang).catch(() => en);
    try { document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'; } catch {}
    document.body.classList.toggle('easy', isEasy());
    return cur;
  }
  function t(path, vars) {
    const v = (cur && get(cur, path)) ?? get(en, path) ?? path;
    return typeof v === 'string' ? tmpl(v, vars) : v;
  }
  function getLang() { return lang; }
  async function setLang(l) {
    if (!LANGS.includes(l)) return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch {}
    cur = await load(l);
    try { document.documentElement.lang = l === 'hi' ? 'hi' : 'en'; } catch {}
    applyStatic();
    logActivity('language_changed', { lang: l });
  }
  function applyStatic(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
  }
  function isEasy() {
    try { return localStorage.getItem('seatswap_easy_v1') === '1'; } catch { return false; }
  }
  function setEasy(on) {
    try { localStorage.setItem('seatswap_easy_v1', on ? '1' : '0'); } catch {}
    document.body.classList.toggle('easy', !!on);
    logActivity('easy_mode_changed', { on: !!on });
  }
  function logActivity(action, meta) {
    try {
      if (typeof SeatSwapStore !== 'undefined') SeatSwapStore.logActivity(action, meta);
    } catch {}
  }
  return { init, t, getLang, setLang, applyStatic, isEasy, setEasy, LANGS };
})();
