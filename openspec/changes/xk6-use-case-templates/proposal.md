## Why

The custom `rem-apps/xk6` Docker image bundles multiple xk6 extensions (kubernetes, disruptor, sql, loki, prometheus-remote, exec) and AWS jslibs, but teams lack reusable k6 script templates and agent skills to exploit these capabilities consistently. Without a documented template library, each engineer reinvents scripts, misconfigures outputs for K6 Stratos, and underuses chaos/SQL/AWS features baked into the image.

## What Changes

- Add a project Cursor skill `xk6-use-case-templates` with an index, image capability reference, and portal integration guide.
- Add ready-to-copy k6 JavaScript templates for every use case identified in the xk6 image exploration: HTTP load patterns, SQL/Postgres, AWS services, chaos/disruptor, Kubernetes orchestration, observability outputs, exec helpers, and K6 Stratos deployment snippets.
- Document placeholders (`__BASE_URL__`, `__NAMESPACE__`, etc.), required RBAC/credentials, and recommended `template_type` (testrun / cronjob / job) per script.
- No application code changes to the portal backend or frontend in this change — deliverable is documentation and templates only.

## Capabilities

### New Capabilities

- `xk6-template-library`: Cursor skill and k6 script template files covering all xk6 image use cases, with Stratos portal deployment guidance.

### Modified Capabilities

- _(none — no existing portal spec requirements change)_

## Impact

- **New files**: `.cursor/skills/xk6-use-case-templates/` (SKILL.md, reference docs, `templates/**/*.js`, portal snippets).
- **Consumers**: Engineers authoring ConfigMaps, K6 Stratos templates, and CI smoke tests using `rem-apps/xk6`.
- **Dependencies**: Assumes `rem-apps/xk6` image as defined in `rem-eks-applications/xk6/Dockerfile`; k6 Operator TestRun CRD on target clusters.
- **No breaking changes** to existing APIs or deployments.
