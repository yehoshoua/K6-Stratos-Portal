// xk6-exec: run shell command for DNS/TLS/env validation.
// Portal: template_type=job
import exec from 'k6/x/exec';
import { check } from 'k6';

const HOST = __ENV.CHECK_HOST || 'example.com';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const nslookup = exec.command('nslookup', [HOST]);
  check(nslookup, { 'nslookup exit 0': (r) => r.exit_status === 0 });

  const openssl = exec.command('sh', ['-c', `echo | openssl s_client -connect ${HOST}:443 -servername ${HOST} 2>/dev/null | head -n 5`]);
  check(openssl, { 'tls reachable': (r) => r.exit_status === 0 });
}
