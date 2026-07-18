// Rate limit — high arrival rate, expect 429 after threshold.
// Env: BASE_URL, API_PATH, EXPECT_RATE_LIMIT (true|false)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/api/limited';
const EXPECT_429 = (__ENV.EXPECT_RATE_LIMIT || 'true') === 'true';

export const options = {
  scenarios: {
    rate_limit: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${API_PATH}`);
  if (EXPECT_429) {
    check(res, {
      'eventually rate limited': (r) => r.status === 200 || r.status === 429,
      'got 429 at least sometimes': (r) => r.status === 429,
    });
  } else {
    check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
  }
  sleep(0.05);
}
