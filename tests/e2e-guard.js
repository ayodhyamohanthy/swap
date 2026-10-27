/* Guard for the legacy root E2E suite (tests/e2e-*.js).
   These suites drive the legacy root shell: page title "SwapSeat" and the
   #lookupBtn / #seatmap / #swapList / SwapSeatDebug ids. The root shell has
   since been rebuilt as the seatswap steps-1-2 prototype (title "SeatSwap")
   and ships none of those ids, so the suite's DOM no longer exists. Rather
   than fail with selector timeouts that look like app regressions, each
   suite skips with an explanation. The replacement Playwright setup for the
   app lives in app/e2e (branch fo/swap-e2e-pnr-flow). */
const http = require('http');

function fetchRootHtml(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { resolve(null); return; }
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: (u.pathname || '/') + (u.search || '') },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body));
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

/* Call as `await e2eGuard(BASE)` at the top of the suite. */
module.exports = async function guard(BASE) {
  const html = await fetchRootHtml(BASE);
  if (html === null) {
    console.log('E2E skipped: no server answered at ' + BASE + '. Start it first, e.g. PORT=8099 node server/dev-server.js.');
    process.exit(1);
  }
  if (!html.includes('lookupBtn')) {
    console.log('E2E skipped (suite stale): this suite drives the legacy root shell (title "SwapSeat", #lookupBtn/#seatmap/#swapList/SwapSeatDebug).');
    console.log('The root shell is now the seatswap steps-1-2 prototype (title "SeatSwap") and has none of those ids, so the suite cannot run.');
    console.log('Replacement Playwright setup for the app: app/e2e (branch fo/swap-e2e-pnr-flow).');
    process.exit(0);
  }
};
