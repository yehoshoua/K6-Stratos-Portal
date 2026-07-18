// Soak / endurance — long duration, moderate VUs.
// Portal: template_type=cronjob|testrun, run off-peak
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/';
const SOAK_DURATION = __ENV.SOAK_DURATION || '1h';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: SOAK_DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${API_PATH}`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(2);
}
