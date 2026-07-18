// Pipeline: HTTP request then SQS message (event-driven flow).
// Env: BASE_URL, API_PATH, AWS_REGION, SQS_QUEUE_URL
import http from 'k6/http';
import { AWSConfig, SQSClient } from '/jslibs/aws/sqs.js';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://test.k6.io';
const API_PATH = __ENV.API_PATH || '/api/events';
const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const sqs = new SQSClient(aws);
const queueUrl = __ENV.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/events';

export const options = { vus: 3, duration: '3m' };

export default function () {
  const payload = JSON.stringify({ type: 'order', vu: __VU });
  const httpRes = http.post(`${BASE_URL}${API_PATH}`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(httpRes, { 'http ok': (r) => r.status >= 200 && r.status < 300 });

  const sqsRes = sqs.sendMessage(queueUrl, payload);
  check(sqsRes, { 'sqs ok': (r) => !r.error });
  sleep(1);
}
