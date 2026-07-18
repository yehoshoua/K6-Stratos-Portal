// Phased: HTTP load while injecting network latency mid-test.
// Env: BASE_URL, TARGET_NAMESPACE, TARGET_APP_LABEL
import http from 'k6/http';
import { PodDisruptor } from 'k6/x/disruptor';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const NS = __ENV.TARGET_NAMESPACE || 'default';
const APP = __ENV.TARGET_APP_LABEL || 'myapp';

export const options = {
  scenarios: {
    load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
      exec: 'loadTest',
    },
    chaos: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '2m',
      exec: 'chaosTest',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<3000'],
  },
};

export function chaosTest() {
  const disruptor = new PodDisruptor({ namespace: NS, labels: { app: APP } });
  disruptor.injectNetworkLatency({ latency: '300ms', duration: '90s' });
  sleep(100);
}

export function loadTest() {
  const res = http.get(BASE_URL);
  check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 500 });
  sleep(0.5);
}
