# K6 Stratos Portal Integration

## Runner image

Set in **Settings → Run defaults** or per template:

```
rem-helm-images/rem-apps/xk6:latest
# or ECR: <account>.dkr.ecr.<region>.amazonaws.com/rem-apps/xk6:v1.1
```

## Template types

| Portal `template_type` | K8s kind | When to use |
|------------------------|----------|-------------|
| `testrun` | TestRun (k6.io) | Distributed load, chaos, most HTTP tests |
| `cronjob` | CronJob | Scheduled regression, soak (off-hours) |
| `job` | Job | One-shot smoke after deploy |

## Metrics output (default)

Stratos run defaults typically use InfluxDB:

```
--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s
```

See `templates/observability/influxdb-output.md` for alternatives (Loki, Prometheus RW).

## Environment variables on TestRun

Pass via k6 Operator `spec.runner.env` or ConfigMap — map from portal when supported, or patch CRD:

| Variable | Used by |
|----------|---------|
| `BASE_URL` | HTTP templates |
| `AWS_REGION` | AWS templates |
| `PG_DSN` | SQL templates |
| `LOKI_URL` | Loki template |
| `PROMETHEUS_RW_URL` | Prometheus remote write |
| `TARGET_NAMESPACE`, `TARGET_LABELS` | chaos, k8s templates |

## RBAC for chaos / kubernetes templates

Runner ServiceAccount needs (target namespace):

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale"]
    verbs: ["get", "list", "watch", "patch", "update"]
```

Disruptor may require additional permissions per fault type — test in a non-prod namespace first.

## AWS credentials

Prefer **IRSA** on the k6 runner pod. Avoid long-lived keys in ConfigMaps.

## Example payloads

- TestRun: [templates/portal/testrun-payload.example.json](templates/portal/testrun-payload.example.json)
- CronJob soak: [templates/portal/cronjob-soak.example.json](templates/portal/cronjob-soak.example.json)
- Job smoke: [templates/portal/job-smoke.example.json](templates/portal/job-smoke.example.json)

## Portal API (deploy TestRun)

```bash
curl -X POST "$PORTAL/api/k8s/clusters/$CLUSTER_ID/crds?namespace=$NS" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @templates/portal/testrun-payload.example.json
```
