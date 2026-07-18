// Spike test — sudden traffic increase.
// Portal: template_type=testrun, parallelism=5-50
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '1m', target: 500 },
        { duration: '10s', target: 10 },
        { duration: '3m', target: 10 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${API_PATH}`);
  check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 400 });
  sleep(0.1);
}
