// Secrets Manager GetSecretValue — use sparingly (rate limits).
// Env: AWS_REGION, SECRET_ARN or SECRET_NAME
import { AWSConfig, SecretsManagerClient } from '/jslibs/aws/secrets-manager.js';
import { check, sleep } from 'k6';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const sm = new SecretsManagerClient(aws);
const secretId = __ENV.SECRET_ARN || __ENV.SECRET_NAME || 'my-secret';

export const options = { vus: 1, iterations: 10 };

export default function () {
  const res = sm.getSecretValue(secretId);
  check(res, { 'secret fetched': (r) => !r.error && r.secretString });
  sleep(2);
}
