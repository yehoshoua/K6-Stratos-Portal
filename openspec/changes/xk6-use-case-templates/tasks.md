## 1. Skill scaffold

- [x] 1.1 Create `.cursor/skills/xk6-use-case-templates/` directory structure
- [x] 1.2 Write `SKILL.md` with frontmatter, category index, and usage workflow
- [x] 1.3 Write `image-capabilities.md` documenting the xk6 Dockerfile extensions and jslibs
- [x] 1.4 Write `portal-integration.md` (TestRun, CronJob, Job, RBAC, outputs)
- [x] 1.5 Write `template-catalog.md` mapping every template to portal metadata

## 2. HTTP templates (`templates/http/`)

- [x] 2.1 `smoke.js` — minimal health check
- [x] 2.2 `load.js` — nominal load with thresholds
- [x] 2.3 `stress.js` — ramp beyond nominal capacity
- [x] 2.4 `spike.js` — sudden VU spike
- [x] 2.5 `soak.js` — long-duration endurance
- [x] 2.6 `breakpoint.js` — ramp until failure threshold
- [x] 2.7 `rest-crud.js` — POST/GET/PUT/DELETE flow
- [x] 2.8 `auth-jwt.js` — login + bearer token requests
- [x] 2.9 `websocket.js` — WebSocket session under load
- [x] 2.10 `rate-limit.js` — validate 429 behavior

## 3. SQL templates (`templates/sql/`)

- [x] 3.1 `read-under-load.js` — parallel SELECT
- [x] 3.2 `write-under-load.js` — INSERT/UPDATE load
- [x] 3.3 `hybrid-http-sql.js` — HTTP action then SQL verification
- [x] 3.4 `connection-pool.js` — sustained DB connections

## 4. AWS templates (`templates/aws/`)

- [x] 4.1 `s3-upload-download.js`
- [x] 4.2 `sqs-send-receive.js`
- [x] 4.3 `lambda-invoke.js`
- [x] 4.4 `kinesis-put.js`
- [x] 4.5 `ssm-get-parameter.js`
- [x] 4.6 `secrets-manager-get.js`
- [x] 4.7 `kms-encrypt.js`
- [x] 4.8 `eventbridge-put-events.js`
- [x] 4.9 `pipeline-http-sqs.js` — combined HTTP + SQS

## 5. Chaos templates (`templates/chaos/`)

- [x] 5.1 `network-latency.js` — disruptor network latency
- [x] 5.2 `pod-kill.js` — terminate target pod during test
- [x] 5.3 `chaos-with-http-load.js` — HTTP load + disruption phases
- [x] 5.4 `rollout-under-load.js` — disruption during rollout window

## 6. Kubernetes templates (`templates/k8s/`)

- [x] 6.1 `scale-deployment.js` — scale replicas during test
- [x] 6.2 `wait-rollout.js` — wait for deployment ready
- [x] 6.3 `check-pod-readiness.js` — poll pod phase/ready

## 7. Observability templates (`templates/observability/`)

- [x] 7.1 `loki-push.js` — xk6-loki log shipping
- [x] 7.2 `prometheus-remote-write.js` — remote write options pattern
- [x] 7.3 `influxdb-output.md` — InfluxDB CLI/output args for Stratos

## 8. Exec and portal snippets

- [x] 8.1 `templates/exec/shell-check.js` — xk6-exec command validation
- [x] 8.2 `templates/portal/testrun-payload.example.json`
- [x] 8.3 `templates/portal/cronjob-soak.example.json`
- [x] 8.4 `templates/portal/job-smoke.example.json`

## 9. Verification

- [x] 9.1 Verify every path referenced in SKILL.md exists
- [x] 9.2 Verify template-catalog.md lists all templates with portal metadata
- [x] 9.3 Spot-check imports match `/jslibs/aws/` and `k6/x/*` extension paths
