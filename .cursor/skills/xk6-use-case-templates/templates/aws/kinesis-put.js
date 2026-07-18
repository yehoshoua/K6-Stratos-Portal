// Kinesis PutRecord under load.
// Env: AWS_REGION, KINESIS_STREAM_NAME
import { AWSConfig, KinesisClient } from '/jslibs/aws/kinesis.js';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const kinesis = new KinesisClient(aws);
const stream = __ENV.KINESIS_STREAM_NAME || 'my-stream';

export const options = { vus: 3, duration: '2m' };

export default function () {
  const data = JSON.stringify({ event: 'k6', id: randomString(8) });
  const res = kinesis.putRecord(stream, data, `partition-${__VU}`);
  check(res, { 'put ok': (r) => !r.error });
  sleep(0.5);
}
