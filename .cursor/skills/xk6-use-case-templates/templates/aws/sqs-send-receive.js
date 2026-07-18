// SQS send message (receive requires long-polling setup).
// Env: AWS_REGION, SQS_QUEUE_URL
import { AWSConfig, SQSClient } from '/jslibs/aws/sqs.js';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const sqs = new SQSClient(aws);
const queueUrl = __ENV.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue';

export const options = { vus: 5, duration: '2m' };

export default function () {
  const body = JSON.stringify({ id: randomString(8), vu: __VU, iter: __ITER });
  const res = sqs.sendMessage(queueUrl, body);
  check(res, { 'message sent': (r) => !r.error });
  sleep(0.5);
}
