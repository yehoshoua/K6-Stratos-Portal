#!/usr/bin/env bash
# Import all K6 Stratos portal templates from portal-k6-templates/*.json
# Usage:
#   PORTAL_URL=http://localhost:8080 TOKEN=stratum_tok_... ./import-portal-templates.sh
#   ./import-portal-templates.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="${SCRIPT_DIR}/portal-k6-templates"
PORTAL_URL="${PORTAL_URL:-http://localhost:8080}"
TOKEN="${TOKEN:-}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: PORTAL_URL=... TOKEN=... $0 [--dry-run]"
      exit 0
      ;;
  esac
done

if [[ "$DRY_RUN" != "true" && -z "$TOKEN" ]]; then
  echo "ERROR: set TOKEN (API token or JWT from /api/auth/login)" >&2
  exit 1
fi

existing_templates=""
if [[ "$DRY_RUN" != "true" ]]; then
  echo "Fetching existing templates..."
  existing_templates=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${PORTAL_URL}/api/settings/templates" || echo "[]")
fi

shopt -s nullglob
files=("$TEMPLATES_DIR"/xk6-*.json)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No templates found in $TEMPLATES_DIR" >&2
  exit 1
fi

ok=0
fail=0

for f in "${files[@]}"; do
  name=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['name'])" "$f")
  payload=$(python3 -c "
import json, sys
t = json.load(open(sys.argv[1]))
body = {
  'name': t['name'],
  'template_type': t['template_type'],
  'parallelism': t.get('parallelism', 0),
  'script_name': t['script_name'],
  'script_file': t['script_file'],
  'runner_image': t.get('runner_image', ''),
  'cpu_limit': t['cpu_limit'],
  'mem_limit': t['mem_limit'],
  'script_content': t['script_content'],
}
if t.get('schedule_cron_expression'):
    body['schedule_cron_expression'] = t['schedule_cron_expression']
print(json.dumps(body))
" "$f")

  existing_id=""
  if [[ "$DRY_RUN" != "true" && -n "$existing_templates" && "$existing_templates" != "[]" ]]; then
    existing_id=$(python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    target = sys.argv[2].lower().strip()
    for t in data:
        if t.get('name', '').lower().strip() == target:
            print(t.get('id', ''))
            break
except Exception:
    pass
" "$existing_templates" "$name")
  fi

  if [[ -n "$existing_id" ]]; then
    method="PUT"
    url="${PORTAL_URL}/api/settings/templates/${existing_id}"
    action="update"
  else
    method="POST"
    url="${PORTAL_URL}/api/settings/templates"
    action="create"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] would import: $name (method: $method)"
    ((ok++)) || true
    continue
  fi

  http_code=$(curl -s -o /tmp/k6-tpl-import-resp.json -w "%{http_code}" \
    -X "$method" "$url" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
    echo "OK  $name ($action: $http_code)"
    ((ok++)) || true
  else
    echo "FAIL $name ($action: $http_code): $(cat /tmp/k6-tpl-import-resp.json)" >&2
    ((fail++)) || true
  fi
done

echo "---"
echo "Imported/Updated: $ok | Failed: $fail | Total: ${#files[@]}"
[[ "$fail" -eq 0 ]]
