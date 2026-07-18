// KMS encrypt under load.
// Env: AWS_REGION, KMS_KEY_ID
import { AWSConfig, KMSClient } from '/jslibs/aws/kms.js';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const kms = new KMSClient(aws);
const keyId = __ENV.KMS_KEY_ID || 'alias/my-key';

export const options = { vus: 3, duration: '1m' };

export default function () {
  const plaintext = randomString(32);
  const res = kms.encrypt(keyId, plaintext);
  check(res, { 'encrypted': (r) => !r.error && r.ciphertextBlob });
  sleep(0.5);
}
