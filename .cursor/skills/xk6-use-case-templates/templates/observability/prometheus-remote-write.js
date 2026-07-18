// Prometheus remote write — configure via k6 CLI argumentsText in Stratos.
// This script runs HTTP load; metrics ship via --out experimental-prometheus-rw
//
// Portal argumentsText example:
//   --out experimental-prometheus-rw=serverUrl=http://mimir.monitoring.svc:8080/api/v1/push,tenantID=default
//
// Env: PROMETHEUS_RW_URL (documentation only), BASE_URL
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(BASE_URL);
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(0.5);
}
