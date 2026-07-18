// Poll pods until all matching labels are Ready.
// Env: TARGET_NAMESPACE, TARGET_APP_LABEL
import { Kubernetes } from 'k6/x/kubernetes';
import { check, sleep } from 'k6';

const NS = __ENV.TARGET_NAMESPACE || 'default';
const APP = __ENV.TARGET_APP_LABEL || 'myapp';

const k8s = new Kubernetes();

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const deadline = Date.now() + 5 * 60 * 1000;
  let ready = false;

  while (Date.now() < deadline) {
    const pods = k8s.pods.list(NS, { labels: { app: APP } });
    ready = pods.length > 0 && pods.every((p) => p.ready);
    if (ready) break;
    sleep(5);
  }

  check(ready, { 'all pods ready': (v) => v === true });
}
