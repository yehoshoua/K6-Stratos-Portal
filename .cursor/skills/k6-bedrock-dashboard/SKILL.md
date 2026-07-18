---
name: k6-bedrock-dashboard
description: Maintain and evolve the K6 Stratos portal, a Go and Next.js control plane for Kubernetes k6 tests. Use for frontend or backend changes, REST API work, authentication and RBAC, InfluxDB telemetry, schedules, Kubernetes TestRuns, and production validation in this repository.
---

# K6 Stratos Portal

## Scope

Work in this monorepo:

- `backend/`: Go HTTP API, SQLite/PostgreSQL persistence, Kubernetes `client-go`, InfluxDB, scheduling, authentication, and RBAC.
- `frontend/`: Next.js 16 / React 19 dashboard, Tailwind styles, six UI locales, and a same-origin `/api` proxy.
- `docker-compose.yaml`, `Caddyfile`, and `k8s-deployment.yaml`: local and Kubernetes deployment.

## Workflow

1. Inspect the affected API route, handler, database model, and frontend client before editing.
2. For frontend changes, read `frontend/AGENTS.md` and the relevant guide under `frontend/node_modules/next/dist/docs/` first.
3. Preserve the API contract in `frontend/src/services/api.ts`; add or change backend and frontend endpoints together.
4. Enforce authorization on the backend. UI role checks are presentation only.
5. Keep cluster credentials, InfluxDB credentials, JWTs, and API tokens out of logs and browser storage.
6. Run `go test ./...` in `backend/` and `npm run build` in `frontend/` after changes.

## Security Rules

- Keep browser sessions in the `session_token` HttpOnly cookie; do not add JWTs to `localStorage` or URL query strings.
- Accept API tokens only from `Authorization: Bearer`; store only their SHA-256 hashes.
- Compare comma-separated scopes exactly with a parser, never with substring matching.
- Require `JWT_SECRET` and `ENCRYPTION_KEY` when `APP_ENV=production`; never add real defaults to manifests or Compose files.
- Keep CORS same-origin by default. Use `CORS_ALLOWED_ORIGINS` only for explicit cross-origin clients.

## Domain Rules

- Use `k6.io/v1alpha1` TestRuns, with the legacy `k6s` resource only as the existing backend fallback.
- Treat a missing InfluxDB endpoint as unconfigured, not online. Check `/api/influx/status` before rendering telemetry health.
- Restrict Kubernetes mutations to editor or administrator roles; cluster, user, SSO, and token management remain administrator-only.
- Keep schedules leader-gated; do not start duplicate schedule workers on multiple backend replicas.

## Verification

Use the production build as the frontend acceptance check. If `npm run lint` fails on existing code, report it separately and do not hide it by weakening lint rules.
