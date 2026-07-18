// Disruptor: terminate a target pod (chaos — non-prod only).
// Env: TARGET_NAMESPACE, TARGET_APP_LABEL
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

  disruptor.terminatePods();
  sleep(30);
}
