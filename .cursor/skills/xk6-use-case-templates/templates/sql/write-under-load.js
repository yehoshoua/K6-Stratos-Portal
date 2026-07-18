// Postgres write under load — requires writable table `k6_load_test`.
// Env: PG_DSN
// Setup: CREATE TABLE k6_load_test (id serial PRIMARY KEY, vu int, iter int, ts timestamptz DEFAULT now());
import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { check, sleep } from 'k6';

const db = sql.open(driver, __ENV.PG_DSN || 'postgres://localhost:5432/k6?sslmode=disable');

export const options = {
  vus: 5,
  duration: '3m',
};

export function teardown() {
  db.close();
}

export default function () {
  sql.exec(db, 'INSERT INTO k6_load_test (vu, iter) VALUES ($1, $2)', __VU, __ITER);
  const rows = sql.query(db, 'SELECT count(*)::int AS c FROM k6_load_test');
  check(rows, { 'insert visible': (r) => r[0].c > 0 });
  sleep(1);
}
