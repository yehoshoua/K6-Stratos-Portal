# Portal K6 Templates (K6 Stratos)

33 templates JSON — one per k6 script in `templates/`. Ready to import into **Settings → K6 Run Templates** via API.

## Files

| Pattern | Example |
|---------|---------|
| `xk6-<category>-<use-case>.json` | `xk6-http-load.json` |
| `index.json` | Catalog of all templates |

Each JSON contains inline `script_content` plus portal fields: `template_type`, `parallelism`, `cpu_limit`, `mem_limit`, `runner_image`.

## Template types

| Type | Count | Examples |
|------|-------|----------|
| `testrun` | 25 | load, stress, chaos, AWS, SQL |
| `job` | 7 | smoke, shell-check, wait-rollout, SSM |
| `cronjob` | 1 | soak (nightly `0 2 * * *`) |

## Import via script

```bash
cd .cursor/skills/xk6-use-case-templates

# Login
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

# Dry run
./import-portal-templates.sh --dry-run

# Import all 33 templates
PORTAL_URL=http://localhost:8080 TOKEN="$TOKEN" ./import-portal-templates.sh
```

## Import single template

```bash
curl -X POST http://localhost:8080/api/settings/templates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @portal-k6-templates/xk6-http-smoke.json
```

Strip non-API fields (`output_args`, `use_output`, `category`, `description`) if posting raw file — the import script handles this.

## After import

- **CRDs page** → pick `testrun` templates (load, chaos, etc.)
- **Schedules page** → pick `cronjob` (soak) or `job` (smoke, gates)
- Adjust env vars on the TestRun / runner pod (`BASE_URL`, `PG_DSN`, `AWS_REGION`, …)
