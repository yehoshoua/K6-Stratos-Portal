// Postgres read under load.
// Env: PG_DSN
import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { check, sleep } from 'k6';

const db = sql.open(driver, __ENV.PG_DSN || 'postgres://localhost:5432/k6?sslmode=disable');

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: { checks: ['rate>0.99'] },
};

export function teardown() {
  db.close();
}

export default function () {
  const rows = sql.query(db, 'SELECT 1 AS ok');
  check(rows, { 'row returned': (r) => r.length > 0 && r[0].ok === 1 });
  sleep(0.5);
}
