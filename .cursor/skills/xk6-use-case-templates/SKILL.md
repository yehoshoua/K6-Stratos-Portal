---
name: xk6-use-case-templates
description: >-
  Provides reusable k6 script templates for the rem-apps/xk6 Docker image
  (kubernetes, disruptor, sql/postgres, loki, prometheus-remote, exec, AWS jslibs).
  Use when authoring load tests, chaos tests, AWS integration tests, or deploying
  scripts via K6 Stratos TestRun/CronJob/Job.
---

# xk6 Use Case Templates

Templates for `rem-apps/xk6` (`rem-eks-applications/xk6/Dockerfile`). Copy a script, replace `__ENV` values, deploy via K6 Stratos or `k6 run`.

## Quick workflow

1. Pick a template from [template-catalog.md](template-catalog.md).
2. **Option A — Portal import:** use a ready JSON from [portal-k6-templates/](portal-k6-templates/) (33 templates, one per script).
3. **Option B — Manual:** copy `templates/<category>/<file>.js` into `script_content`.
4. Set env vars on the TestRun runner (see [portal-integration.md](portal-integration.md)).
5. Deploy with the correct `template_type` (testrun / cronjob / job).

### Bulk import into K6 Stratos

Les fichiers JSON **ne sont pas visibles** dans Settings tant qu’ils ne sont pas en base. Deux options :

**Option 1 — Script d’import (immédiat, sans rebuild)**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

PORTAL_URL=http://localhost:8080 TOKEN="$TOKEN" ./import-portal-templates.sh
```

**Option 2 — Seed au démarrage du backend** (templates manquants insérés automatiquement après rebuild/restart).

## Template index

| Category | Path | Use cases |
|----------|------|-----------|
| HTTP | [templates/http/](templates/http/) | smoke, load, stress, spike, soak, breakpoint, CRUD, auth, WS, rate limit |
| SQL | [templates/sql/](templates/sql/) | Postgres read/write, hybrid HTTP+SQL |
| AWS | [templates/aws/](templates/aws/) | S3, SQS, Lambda, Kinesis, SSM, Secrets, KMS, EventBridge |
| Chaos | [templates/chaos/](templates/chaos/) | network latency, pod kill, load+chaos |
| K8s | [templates/k8s/](templates/k8s/) | scale, rollout wait, readiness |
| Observability | [templates/observability/](templates/observability/) | Loki, Prometheus RW, InfluxDB |
| Exec | [templates/exec/](templates/exec/) | shell command checks |
| Portal | [portal-k6-templates/](portal-k6-templates/) | 33 Stratos templates JSON (import-ready) |
| Portal examples | [templates/portal/](templates/portal/) | API payload snippets |

## Reference docs

- [image-capabilities.md](image-capabilities.md) — extensions and jslibs in the image
- [portal-integration.md](portal-integration.md) — Stratos deployment, RBAC, outputs
- [template-catalog.md](template-catalog.md) — full catalog with CPU/mem/parallelism hints

## Conventions

- **Env vars**: `__ENV.BASE_URL`, `__ENV.AWS_REGION`, `__ENV.PG_DSN`, etc.
- **AWS imports**: `import ... from '/jslibs/aws/<service>.js'`
- **No secrets in repo**: use IRSA on EKS or K8s secrets mounted as env
- **Default image**: `rem-helm-images/rem-apps/xk6:latest` (see portal run defaults)

## When adapting a template

1. Adjust `options.scenarios` VUs/duration to your SLA.
2. Set `thresholds` for pass/fail (portal relaunch uses same script).
3. For disruptor/k8s: ensure runner ServiceAccount has RBAC on target namespace.
4. For AWS: attach IRSA role with least-privilege policy per service.
