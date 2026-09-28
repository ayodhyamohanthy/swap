import http from 'k6/http';
import { check, sleep } from 'k6';
/* SeatSwap hot-train load plan — ephemeral, Azure VU burn-down.
 * Target: GET /api/matches?train=12951&date=YYYY-MM-DD&class=3A
 * Run: k6 run app/azure/load/get-matches.k6.js -e BASE_URL=https://staging... */
export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 500 },
    { duration: '2m', target: 2000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800'] },
};
const TRAIN = __ENV.TRAIN || '12951';
const DATE = __ENV.DATE || '2026-11-12';
const CLASS = __ENV.CLASS || '3A';
export default function () {
  const base = __ENV.BASE_URL || 'http://localhost:5173';
  const url = `${base}/api/matches?train=${TRAIN}&date=${DATE}&class=${CLASS}&limit=20`;
  const res = http.get(url);
  check(res, { '200 + <=20 rows': (r) => r.status === 200 });
  sleep(1);
}
