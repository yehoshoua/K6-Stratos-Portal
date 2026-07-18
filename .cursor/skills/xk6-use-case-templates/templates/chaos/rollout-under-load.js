// Disruption during a rollout window — coordinate with CI deploy.
// Env: TARGET_NAMESPACE, TARGET_APP_LABEL, BASE_URL
import http from 'k6/http';
import { PodDisruptor } from 'k6/x/disruptor';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const NS = __ENV.TARGET_NAMESPACE || 'default';
const APP = __ENV.TARGET_APP_LABEL || 'myapp';

export const options = {
  vus: 15,
  duration: '10m',
};

export function setup() {
  const disruptor = new PodDisruptor({ namespace: NS, labels: { app: APP } });
  disruptor.injectNetworkLatency({ latency: '100ms', duration: '8m' });
  return {};
}

export default function () {
  const res = http.get(BASE_URL);
  check(res, { 'available during rollout': (r) => r.status < 500 });
  sleep(0.3);
}
