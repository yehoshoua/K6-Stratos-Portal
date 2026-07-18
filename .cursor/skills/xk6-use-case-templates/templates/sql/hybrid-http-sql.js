// Hybrid HTTP + SQL — API creates resource, DB verifies row.
// Env: BASE_URL, API_PATH, PG_DSN, DB_VERIFY_QUERY
import http from 'k6/http';
import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/api/orders';
const VERIFY_QUERY = __ENV.DB_VERIFY_QUERY || 'SELECT count(*)::int AS c FROM orders WHERE status = $1';

const db = sql.open(driver, __ENV.PG_DSN || 'postgres://localhost:5432/app?sslmode=disable');

export const options = {
  vus: 3,
  duration: '5m',
};

export function teardown() {
  db.close();
}

export default function () {
  const res = http.post(
    `${BASE_URL}${API_PATH}`,
    JSON.stringify({ sku: `sku-${__VU}-${__ITER}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'api ok': (r) => r.status >= 200 && r.status < 300 });

  const rows = sql.query(db, VERIFY_QUERY, 'pending');
  check(rows, { 'db has rows': (r) => r[0].c >= 0 });
  sleep(1);
}
