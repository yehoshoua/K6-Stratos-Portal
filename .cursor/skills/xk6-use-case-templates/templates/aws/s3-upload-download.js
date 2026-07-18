// S3 upload and download under load.
// Env: AWS_REGION, S3_BUCKET, S3_KEY_PREFIX
import { AWSConfig, S3Client } from '/jslibs/aws/s3.js';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const s3 = new S3Client(aws);
const bucket = __ENV.S3_BUCKET || 'my-bucket';
const prefix = __ENV.S3_KEY_PREFIX || 'k6-load/';

export const options = { vus: 3, duration: '2m' };

export default function () {
  const key = `${prefix}${randomString(8)}.txt`;
  const body = `k6-vu-${__VU}-iter-${__ITER}`;

  const putRes = s3.putObject(bucket, key, body);
  check(putRes, { 'put ok': (r) => !r.error });

  const getRes = s3.getObject(bucket, key);
  check(getRes, { 'get ok': (r) => !r.error && r.body && r.body.includes('k6-vu') });

  sleep(1);
}
