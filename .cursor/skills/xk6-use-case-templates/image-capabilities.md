# rem-apps/xk6 Image Capabilities

Source: `rem-eks-applications/xk6/Dockerfile`

## Base

- **FROM**: `grafana/xk6` → custom `k6` binary
- **WORKDIR**: `/scripts`
- **ENTRYPOINT**: `k6`
- **Platforms**: `linux/amd64`, `linux/arm64` (GitLab CI)

## xk6 extensions (Go)

| Extension | Import | Purpose |
|-----------|--------|---------|
| xk6-kubernetes | `k6/x/kubernetes` | List/scale deployments, pods, rollouts |
| xk6-exec | `k6/x/exec` | Run shell commands from scripts |
| xk6-disruptor | `k6/x/disruptor` | Inject faults (latency, pod kill, CPU stress) |
| xk6-loki | `k6/x/loki` | Push logs to Grafana Loki |
| xk6-client-prometheus-remote | CLI `--out experimental-prometheus-rw` | Remote write to Mimir/Prometheus |
| xk6-sql | `k6/x/sql` | SQL queries during tests |
| xk6-sql-driver-postgres | `k6/x/sql/driver/postgres` | Postgres driver only |

## AWS jslibs 0.14.0 (bundled)

Path: `/jslibs/aws/`

| File | Service |
|------|---------|
| `s3.js` | S3 upload/download |
| `sqs.js` | SQS send/receive |
| `lambda.js` | Lambda invoke |
| `kinesis.js` | Kinesis PutRecord(s) |
| `kms.js` | Encrypt/decrypt |
| `event-bridge.js` | PutEvents |
| `ssm.js` | GetParameter |
| `secrets-manager.js` | GetSecretValue |

## Not included

- xk6-browser (UI tests)
- MySQL/SQLite SQL drivers
- Kafka, Redis, gRPC extensions (use stock k6 gRPC or add to Dockerfile)

## Verify extensions in a running pod

```bash
k6 version
ls /jslibs/aws/
```
