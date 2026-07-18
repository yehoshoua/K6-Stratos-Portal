# Template Catalog

All paths relative to `.cursor/skills/xk6-use-case-templates/`.

## HTTP (`templates/http/`)

| File | Type | Parallelism | CPU | Mem | Notes |
|------|------|-------------|-----|-----|-------|
| smoke.js | testrun, job | 1 | 250m | 256Mi | Post-deploy gate |
| load.js | testrun | 2–10 | 500m | 512Mi | Nominal SLA test |
| stress.js | testrun | 5–20 | 1 | 1Gi | Find breaking point |
| spike.js | testrun | 5–50 | 1 | 1Gi | Sudden traffic |
| soak.js | testrun, cronjob | 2–5 | 500m | 512Mi | 1h+ duration |
| breakpoint.js | testrun | 1 | 1 | 1Gi | Ramp until fail |
| rest-crud.js | testrun | 2 | 500m | 512Mi | API lifecycle |
| auth-jwt.js | testrun | 2 | 500m | 512Mi | Login + API |
| websocket.js | testrun | 5 | 500m | 512Mi | WS connections |
| rate-limit.js | testrun | 10 | 500m | 512Mi | Expect 429 |

**Env:** `BASE_URL`, optional `HEALTH_PATH`, `API_PATH`

## SQL (`templates/sql/`)

| File | Type | Parallelism | CPU | Mem | Notes |
|------|------|-------------|-----|-----|-------|
| read-under-load.js | testrun | 5 | 500m | 512Mi | SELECT heavy |
| write-under-load.js | testrun | 3 | 500m | 512Mi | INSERT/UPDATE |
| hybrid-http-sql.js | testrun | 2 | 1 | 1Gi | HTTP + verify DB |
| connection-pool.js | testrun | 10 | 500m | 512Mi | Pool saturation |

**Env:** `PG_DSN` (e.g. `postgres://user:pass@host:5432/db?sslmode=disable`)

## AWS (`templates/aws/`)

| File | Type | Parallelism | CPU | Mem | Notes |
|------|------|-------------|-----|-----|-------|
| s3-upload-download.js | testrun, job | 1–5 | 500m | 512Mi | IRSA s3:* |
| sqs-send-receive.js | testrun | 2 | 500m | 512Mi | Queue URL required |
| lambda-invoke.js | testrun | 2 | 500m | 512Mi | Function name |
| kinesis-put.js | testrun | 2 | 500m | 512Mi | Stream name |
| ssm-get-parameter.js | testrun, job | 1 | 250m | 256Mi | Param name |
| secrets-manager-get.js | testrun, job | 1 | 250m | 256Mi | Secret ARN |
| kms-encrypt.js | testrun | 2 | 250m | 256Mi | Key ID |
| eventbridge-put-events.js | testrun | 2 | 500m | 512Mi | Event bus |
| pipeline-http-sqs.js | testrun | 2 | 500m | 512Mi | HTTP + SQS |

**Env:** `AWS_REGION`, service-specific (`S3_BUCKET`, `SQS_QUEUE_URL`, etc.)

## Chaos (`templates/chaos/`)

| File | Type | Parallelism | CPU | Mem | Notes |
|------|------|-------------|-----|-----|-------|
| network-latency.js | testrun | 1 | 500m | 512Mi | RBAC + disruptor |
| pod-kill.js | testrun | 1 | 500m | 512Mi | Non-prod only |
| chaos-with-http-load.js | testrun | 5 | 1 | 1Gi | Phased load+fault |
| rollout-under-load.js | testrun | 1 | 1 | 1Gi | Disrupt during deploy |

**Env:** `TARGET_NAMESPACE`, `TARGET_APP_LABEL`, `BASE_URL`

## Kubernetes (`templates/k8s/`)

| File | Type | Parallelism | CPU | Mem | Notes |
|------|------|-------------|-----|-----|-------|
| scale-deployment.js | testrun | 1 | 500m | 512Mi | Scale test |
| wait-rollout.js | testrun, job | 1 | 250m | 256Mi | Pre-smoke gate |
| check-pod-readiness.js | testrun, job | 1 | 250m | 256Mi | Readiness poll |

**Env:** `TARGET_NAMESPACE`, `DEPLOYMENT_NAME`

## Observability (`templates/observability/`)

| File | Type | Notes |
|------|------|-------|
| loki-push.js | testrun | Set `LOKI_URL`, use with HTTP load |
| prometheus-remote-write.js | testrun | `argumentsText` for RW URL |
| influxdb-output.md | all | Stratos default output |

## Exec (`templates/exec/`)

| File | Type | Notes |
|------|------|-------|
| shell-check.js | job | DNS/TLS/cli validation |

## Portal K6 templates (`portal-k6-templates/`)

33 JSON files importables dans **Settings → K6 Run Templates** (un par script `.js`).

| Prefix | Count | `template_type` |
|--------|-------|-----------------|
| `xk6-http-*` | 10 | testrun (9), cronjob (soak), job (smoke) |
| `xk6-sql-*` | 4 | testrun |
| `xk6-aws-*` | 9 | testrun (7), job (ssm, secrets-manager) |
| `xk6-chaos-*` | 4 | testrun |
| `xk6-k8s-*` | 3 | testrun (1), job (2) |
| `xk6-obs-*` | 2 | testrun |
| `xk6-exec-*` | 1 | job |

Import : `./import-portal-templates.sh` — voir [portal-k6-templates/README.md](portal-k6-templates/README.md).

> **Note:** Les templates ne s’affichent dans Stratos qu’après import en base (script ci-dessus) ou au prochain redémarrage du backend (seed automatique depuis `backend/internal/database/seed/`).

## Portal API snippets (`templates/portal/`)

| File | Purpose |
|------|---------|
| testrun-payload.example.json | Immediate distributed test |
| cronjob-soak.example.json | Scheduled soak |
| job-smoke.example.json | One-shot smoke Job |
