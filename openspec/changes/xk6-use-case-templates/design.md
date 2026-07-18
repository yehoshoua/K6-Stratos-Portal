## Context

The `rem-apps/xk6` image (`rem-eks-applications/xk6/Dockerfile`) extends Grafana xk6 with kubernetes, exec, disruptor, loki, prometheus-remote-write, sql/postgres, and AWS jslibs 0.14.0 at `/jslibs/aws/`. K6 Stratos deploys this image via k6 Operator `TestRun` CRDs, CronJobs, and Jobs, with InfluxDB as the default metrics sink.

Teams need copy-paste k6 scripts and agent skills so load, chaos, AWS, SQL, and observability tests are consistent across clusters.

## Goals / Non-Goals

**Goals:**

- One Cursor skill (`xk6-use-case-templates`) as the entry point for all templates.
- One `.js` template per identified use case, using `__ENV` placeholders for target-specific values.
- Reference docs for image capabilities, required RBAC/IRSA, and Stratos portal wiring.
- Portal snippets (TestRun payload, CronJob/Job guidance) per template category.

**Non-Goals:**

- Portal UI or API changes (no new template picker in Settings).
- Auto-import of templates into the database.
- xk6-browser, Kafka, Redis, or other extensions not in the current Dockerfile.
- Production-ready secrets in repo (placeholders only).

## Decisions

### 1. Project skill under `.cursor/skills/`

**Choice:** Store in `k6-stratos-portal/.cursor/skills/xk6-use-case-templates/`.

**Rationale:** Co-located with Stratos portal docs and OpenSpec change; shared with the team via git.

**Alternative:** Personal skill in `~/.cursor/skills/` — rejected; templates are team assets tied to `rem-apps/xk6`.

### 2. Flat category folders + index in SKILL.md

**Choice:**

```
.cursor/skills/xk6-use-case-templates/
├── SKILL.md
├── image-capabilities.md
├── portal-integration.md
├── template-catalog.md
└── templates/
    ├── http/
    ├── sql/
    ├── aws/
    ├── chaos/
    ├── k8s/
    ├── observability/
    ├── exec/
    └── portal/
```

**Rationale:** Progressive disclosure — SKILL.md stays under 500 lines; agent reads `template-catalog.md` or a specific `.js` on demand.

### 3. Placeholder convention

**Choice:** `__ENV.VAR_NAME` in scripts; document defaults in `template-catalog.md`. Optional `__PLACEHOLDER__` in comments for non-env values.

**Rationale:** k6 native pattern; works in TestRun `argumentsText` and ConfigMaps without code generation.

### 4. Template metadata table

**Choice:** `template-catalog.md` maps each file to: category, `template_type` (testrun/cronjob/job), suggested parallelism, CPU/mem, required extensions, RBAC notes.

**Rationale:** Single lookup for humans and agents when creating Stratos templates.

### 5. AWS imports use in-image path

**Choice:** `import ... from '/jslibs/aws/<service>.js'`.

**Rationale:** Matches Dockerfile `COPY --from=downloader /jslibs /jslibs`; avoids CDN dependency at runtime.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| xk6 extension APIs drift with `@latest` builds | Document image tag in SKILL.md; pin extension versions in Dockerfile in a follow-up change |
| Disruptor/k8s templates need cluster RBAC | Document required ServiceAccount permissions in `portal-integration.md` |
| AWS tests incur cost / need credentials | Mark AWS templates as opt-in; use IRSA on EKS |
| Soak/breakpoint templates are long-running | Recommend CronJob for soak; low default VUs in templates |
| Scripts not validated in CI | Optional follow-up: `k6 archive` smoke in xk6 repo pipeline |

## Migration Plan

1. Merge skill directory into `k6-stratos-portal` main branch.
2. Announce in README or internal wiki: skill name `xk6-use-case-templates`.
3. Teams copy scripts into ConfigMaps or inline `script_content` when creating Stratos templates.
4. No cluster rollout required until teams adopt new scripts.

## Open Questions

- Should templates be mirrored into `rem-eks-applications/xk6/examples/` for discoverability at image build time?
- Pin xk6 extension versions in Dockerfile to match template APIs?
