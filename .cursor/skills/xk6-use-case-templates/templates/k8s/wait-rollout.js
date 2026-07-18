// Wait until deployment rollout is complete (pre-smoke gate).
// Env: TARGET_NAMESPACE, DEPLOYMENT_NAME, ROLLOUT_TIMEOUT
import { Kubernetes } from 'k6/x/kubernetes';
import { check, sleep } from 'k6';

const NS = __ENV.TARGET_NAMESPACE || 'default';
const DEPLOY = __ENV.DEPLOYMENT_NAME || 'myapp';
const TIMEOUT = __ENV.ROLLOUT_TIMEOUT || '5m';

const k8s = new Kubernetes();

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const ok = k8s.deployments.waitForRollout(NS, DEPLOY, TIMEOUT);
  check(ok, { 'rollout complete': (v) => v === true });
  sleep(1);
}
