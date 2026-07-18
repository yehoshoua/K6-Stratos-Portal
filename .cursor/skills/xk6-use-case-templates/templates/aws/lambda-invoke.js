// Lambda synchronous invoke under load.
// Env: AWS_REGION, LAMBDA_FUNCTION_NAME
import { AWSConfig, LambdaClient } from '/jslibs/aws/lambda.js';
import { check, sleep } from 'k6';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const lambda = new LambdaClient(aws);
const fn = __ENV.LAMBDA_FUNCTION_NAME || 'my-function';

export const options = { vus: 3, duration: '2m' };

export default function () {
  const payload = JSON.stringify({ action: 'ping', vu: __VU });
  const res = lambda.invoke(fn, payload);
  check(res, { 'invoke ok': (r) => !r.error && r.statusCode === 200 });
  sleep(1);
}
