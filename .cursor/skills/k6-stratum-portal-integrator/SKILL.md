---
name: k6-stratum-portal-integrator
description: Integrate and extend K6 Stratos backend capabilities safely. Use for REST endpoints, Go handlers, database persistence, API tokens, RBAC and scopes, OIDC/SSO, Kubernetes TestRuns, CronJobs, ConfigMaps, and InfluxDB API contracts in this repository.
---

# K6 Stratos Integration

## Implement an API Change

1. Define the request and response type in `frontend/src/services/api.ts`.
2. Register the route in `backend/internal/server/server.go` behind `authMiddleware` and the narrowest applicable authorization wrapper.
3. Implement validation, authorization, and error responses in a focused server file.
4. Persist data through `backend/internal/database`; preserve SQLite and PostgreSQL compatibility by using `db.rebind` for parameters.
5. Update the frontend consumer and verify both builds.

## Authorization

- Use `administrator`, `editor`, `viewer`, or `security_auditor` roles.
- Give API tokens only scopes allowed by their selected role.
- Use `hasScope` for exact scope matching.
- Keep API tokens hashed, expiry-aware, and visible in plaintext only on creation.
- Keep session JWTs in the secure cookie; do not rely on frontend role state for access control.

## Kubernetes and Telemetry

- Respect configured cluster namespaces and ABAC scope checks before issuing Kubernetes requests.
- Use the existing TestRun/legacy CRD fallback rather than inventing another resource path.
- Return a clear unconfigured state when InfluxDB has no endpoint. Do not infer connectivity from an empty metrics result.
- Use leader-gated execution for scheduling work.

## Validate

Run:

```bash
(cd backend && go test ./...)
(cd frontend && npm run build)
```

Report any unavailable integration service instead of fabricating success or mock production data.
