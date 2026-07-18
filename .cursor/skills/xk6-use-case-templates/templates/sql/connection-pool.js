// Connection pool stress — many VUs hold DB connections.
// Env: PG_DSN
import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { check, sleep } from 'k6';

const db = sql.open(driver, __ENV.PG_DSN || 'postgres://localhost:5432/k6?sslmode=disable');

export const options = {
  vus: 20,
  duration: '2m',
};

export function teardown() {
  db.close();
}

export default function () {
  const rows = sql.query(db, 'SELECT pg_sleep(0.1), 1 AS ok');
  check(rows, { 'query ok': (r) => r.length > 0 });
  sleep(0.2);
}
