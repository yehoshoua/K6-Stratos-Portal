// Disruptor: inject network latency on target pods.
// Env: TARGET_NAMESPACE, TARGET_APP_LABEL (app label value)
// RBAC: disruptor permissions on target namespace — test in non-prod first.
import { PodDisruptor } from 'k6/x/disruptor';
import { sleep } from 'k6';

const NS = __ENV.TARGET_NAMESPACE || 'default';
const APP = __ENV.TARGET_APP_LABEL || 'myapp';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const disruptor = new PodDisruptor({
    namespace: NS,
    labels: { app: APP },
  });

  disruptor.injectNetworkLatency({
    latency: __ENV.LATENCY || '200ms',
    duration: __ENV.FAULT_DURATION || '60s',
  });

  sleep(70);
}
