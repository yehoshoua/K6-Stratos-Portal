// EventBridge PutEvents.
// Env: AWS_REGION, EVENT_BUS_NAME, EVENT_SOURCE, EVENT_DETAIL_TYPE
import { AWSConfig, EventBridgeClient } from '/jslibs/aws/event-bridge.js';
import { check, sleep } from 'k6';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const eb = new EventBridgeClient(aws);

export const options = { vus: 3, duration: '2m' };

export default function () {
  const entries = [{
    EventBusName: __ENV.EVENT_BUS_NAME || 'default',
    Source: __ENV.EVENT_SOURCE || 'k6.loadtest',
    DetailType: __ENV.EVENT_DETAIL_TYPE || 'LoadTestEvent',
    Detail: JSON.stringify({ vu: __VU, iter: __ITER }),
  }];
  const res = eb.putEvents(entries);
  check(res, { 'events accepted': (r) => !r.error && r.failedEntryCount === 0 });
  sleep(0.5);
}
