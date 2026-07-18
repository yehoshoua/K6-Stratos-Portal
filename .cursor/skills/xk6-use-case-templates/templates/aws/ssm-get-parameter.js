// SSM GetParameter — watch AWS API rate limits.
// Env: AWS_REGION, SSM_PARAMETER_NAME
import { AWSConfig, SSMClient } from '/jslibs/aws/ssm.js';
import { check, sleep } from 'k6';

const aws = new AWSConfig({ region: __ENV.AWS_REGION || 'us-east-1' });
const ssm = new SSMClient(aws);
const name = __ENV.SSM_PARAMETER_NAME || '/myapp/config/url';

export const options = { vus: 2, duration: '1m' };

export default function () {
  const res = ssm.getParameter(name, true);
  check(res, { 'param fetched': (r) => !r.error && r.parameter });
  sleep(1);
}
