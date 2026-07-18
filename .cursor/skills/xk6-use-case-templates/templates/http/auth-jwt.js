// JWT auth — login then call protected API.
// Env: BASE_URL, LOGIN_PATH, API_PATH, USERNAME, PASSWORD
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const LOGIN_PATH = __ENV.LOGIN_PATH || '/api/auth/login';
const API_PATH = __ENV.API_PATH || '/api/me';

export const options = {
  vus: 5,
  duration: '5m',
  thresholds: { http_req_failed: ['rate<0.01'] },
};

export function setup() {
  const res = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({
      username: __ENV.USERNAME || 'user',
      password: __ENV.PASSWORD || 'pass',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login ok': (r) => r.status === 200 });
  return { token: res.json('token') };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };
  const res = http.get(`${BASE_URL}${API_PATH}`, { headers });
  check(res, { 'authorized': (r) => r.status === 200 });
  sleep(1);
}
