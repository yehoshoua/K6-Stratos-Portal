// Push k6 logs to Loki via xk6-loki.
// Env: LOKI_URL, BASE_URL
// Also set: K6_LOKI_URL or configure in init (see xk6-loki docs)
import loki from 'k6/x/loki';
import http from 'k6/http';
import { check, sleep } from 'k6';

const LOKI_URL = __ENV.LOKI_URL || 'http://loki.monitoring.svc:3100';
const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';

const client = loki.newClient({ url: LOKI_URL, labels: { job: 'k6', test: 'loki-push' } });

export const options = {
  vus: 5,
  duration: '2m',
};

export default function () {
  client.push({ level: 'info', message: `vu=${__VU} iter=${__ITER}` });
  const res = http.get(BASE_URL);
  check(res, { 'ok': (r) => r.status === 200 });
  sleep(1);
}
