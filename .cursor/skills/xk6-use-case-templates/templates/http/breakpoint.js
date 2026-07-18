// Breakpoint — ramp VUs until error rate exceeds threshold.
// Portal: template_type=testrun, parallelism=1, monitor abort
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/';

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 100 },
        { duration: '5m', target: 200 },
        { duration: '5m', target: 300 },
        { duration: '5m', target: 400 },
      ],
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' }],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${API_PATH}`);
  check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 500 });
  sleep(0.1);
}
