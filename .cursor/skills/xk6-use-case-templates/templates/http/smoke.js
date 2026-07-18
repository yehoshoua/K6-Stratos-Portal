// Smoke test — minimal traffic, fast pass/fail.
// Portal: template_type=testrun|job, parallelism=1
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const HEALTH_PATH = __ENV.HEALTH_PATH || '/';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${HEALTH_PATH}`);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
