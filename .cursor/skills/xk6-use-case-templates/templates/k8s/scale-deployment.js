// Scale deployment replicas during a test.
// Env: TARGET_NAMESPACE, DEPLOYMENT_NAME, TARGET_REPLICAS
import { Kubernetes } from 'k6/x/kubernetes';
import { sleep } from 'k6';

const NS = __ENV.TARGET_NAMESPACE || 'default';
const DEPLOY = __ENV.DEPLOYMENT_NAME || 'myapp';
const REPLICAS = parseInt(__ENV.TARGET_REPLICAS || '3', 10);

const k8s = new Kubernetes();

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  k8s.deployments.scale(NS, DEPLOY, REPLICAS);
  sleep(60);
  k8s.deployments.scale(NS, DEPLOY, 1);
}
