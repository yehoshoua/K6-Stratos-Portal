## ADDED Requirements

### Requirement: Cursor skill indexes all xk6 use cases

The project SHALL provide a Cursor skill at `.cursor/skills/xk6-use-case-templates/SKILL.md` that describes the `rem-apps/xk6` image capabilities and links to every k6 script template by category.

#### Scenario: Agent discovers skill by name

- **WHEN** a user or agent invokes the `xk6-use-case-templates` skill
- **THEN** SKILL.md lists template categories (http, sql, aws, chaos, k8s, observability, exec, portal) with file paths under `templates/`

#### Scenario: Skill stays concise

- **WHEN** detailed capability or catalog information is needed
- **THEN** SKILL.md references `image-capabilities.md`, `template-catalog.md`, and `portal-integration.md` rather than inlining full template bodies

### Requirement: HTTP load test templates cover standard patterns

The template library SHALL include distinct k6 scripts for smoke, load, stress, spike, soak, breakpoint, REST CRUD, JWT auth, WebSocket, and rate-limit validation under `templates/http/`.

#### Scenario: Smoke test template

- **WHEN** a user copies `templates/http/smoke.js`
- **THEN** the script uses configurable `BASE_URL`, minimal VUs/duration, and HTTP thresholds suitable for a TestRun smoke check

#### Scenario: Load test template

- **WHEN** a user copies `templates/http/load.js`
- **THEN** the script defines ramping or constant VUs with `p(95)` and error-rate thresholds

### Requirement: Extension-specific templates match the xk6 image

The library SHALL provide templates that use only extensions and jslibs present in `rem-eks-applications/xk6/Dockerfile`: xk6-sql/postgres, AWS jslibs, xk6-disruptor, xk6-kubernetes, xk6-loki, xk6-client-prometheus-remote, and xk6-exec.

#### Scenario: Postgres hybrid template

- **WHEN** a user opens `templates/sql/hybrid-http-sql.js`
- **THEN** the script imports `k6/x/sql` and the postgres driver and documents required `PG_*` environment variables

#### Scenario: Disruptor template

- **WHEN** a user opens `templates/chaos/network-latency.js`
- **THEN** the script imports `k6/x/disruptor` and documents target namespace/label placeholders

#### Scenario: AWS S3 template

- **WHEN** a user opens `templates/aws/s3-upload-download.js`
- **THEN** the script imports from `/jslibs/aws/s3.js` and documents AWS credential expectations (IRSA or env)

### Requirement: Portal deployment guidance per template

The library SHALL document how to run each template category via K6 Stratos (TestRun, CronJob, Job) including suggested `template_type`, parallelism, and `output_args` in `portal-integration.md` and `templates/portal/`.

#### Scenario: TestRun deployment snippet

- **WHEN** a user deploys an HTTP load template via the portal API
- **THEN** `templates/portal/testrun-payload.example.json` shows a valid payload shape with `scriptName`, `parallelism`, and InfluxDB `argumentsText`

#### Scenario: Catalog maps template to portal type

- **WHEN** a user consults `template-catalog.md` for a soak test
- **THEN** the catalog recommends `cronjob` or `testrun` with appropriate duration and resource limits

### Requirement: Templates use environment placeholders not hardcoded secrets

Every template script SHALL read target URLs, credentials, and resource names from `__ENV` or documented placeholders; it MUST NOT contain real API keys, passwords, or cluster-specific production endpoints.

#### Scenario: Configurable base URL

- **WHEN** any HTTP template is executed
- **THEN** `BASE_URL` (or equivalent) is read from `__ENV` with a safe example default only
