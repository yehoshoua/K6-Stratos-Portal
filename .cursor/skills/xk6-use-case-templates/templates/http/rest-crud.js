// REST CRUD flow — create, read, update, delete.
// Portal: template_type=testrun
// Env: BASE_URL, RESOURCE_PATH (e.g. /api/items)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const RESOURCE_PATH = __ENV.RESOURCE_PATH || '/api/items';

export const options = {
  vus: 5,
  duration: '5m',
  thresholds: { http_req_failed: ['rate<0.02'] },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  const payload = JSON.stringify({ name: `item-${__VU}-${__ITER}`, value: 42 });

  const createRes = http.post(`${BASE_URL}${RESOURCE_PATH}`, payload, { headers });
  check(createRes, { 'create 2xx': (r) => r.status >= 200 && r.status < 300 });

  const id = createRes.json('id') || '1';
  const getRes = http.get(`${BASE_URL}${RESOURCE_PATH}/${id}`);
  check(getRes, { 'get 200': (r) => r.status === 200 });

  const updateRes = http.put(`${BASE_URL}${RESOURCE_PATH}/${id}`, JSON.stringify({ name: 'updated' }), { headers });
  check(updateRes, { 'update 2xx': (r) => r.status >= 200 && r.status < 300 });

  const delRes = http.del(`${BASE_URL}${RESOURCE_PATH}/${id}`);
  check(delRes, { 'delete 2xx': (r) => r.status >= 200 && r.status < 300 });

  sleep(1);
}
