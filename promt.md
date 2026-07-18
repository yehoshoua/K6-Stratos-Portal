Act as a principal platform architect, staff full-stack engineer, cloud security architect, and product designer.

Design and generate a production-grade enterprise web application for centralized management of multiple Amazon EKS clusters across multiple AWS accounts.

The application must be enterprise-level, secure by default, multi-tenant ready, multilingual, theme-aware, API-first, and suitable for internal platform engineering teams operating at scale.

Project goal:
Build a unified control plane web app for:
- Multi-account AWS EKS fleet management
- Azure AD SSO authentication and RBAC
- Internal user management
- Token-based REST API access
- k6 performance test execution as Kubernetes Jobs and CronJobs
- InfluxDB integration for real-time and historical metrics
- Live Kubernetes logs streaming
- Unified observability dashboard combining logs, test status, and InfluxDB data

Supported languages:
- English (en)
- French (fr)
- Spanish (es)
- German (de)
- Hebrew (he)
- Chinese (zh)

Theme support:
- Light
- Dark
- System theme using OS/browser preference

Identity and access requirements:
- Azure AD SSO for enterprise login via OIDC / OpenID Connect
- Internal user management for platform-owned users, profiles, team membership, role assignment, status, and audit trail
- Support both SSO-based users and internally managed service users where appropriate
- Fine-grained RBAC and optional ABAC
- Scope access by organization, team, AWS account, EKS cluster, namespace, environment, and action
- Full auditability for authentication, authorization, token issuance, test creation, test launch, schedule changes, and admin actions

REST API requirements:
Design a secure REST API for:
- Listing clusters, accounts, namespaces, workloads, tests, test runs, schedules, metrics, logs, and users
- Creating test definitions
- Updating and versioning test definitions
- Launching one-off k6 tests
- Scheduling recurring k6 tests
- Cancelling running tests
- Viewing results and execution metadata
- Managing API tokens
- Managing internal users and role assignments

Token model:
- All API access must be token-based
- No session-cookie dependency for API consumers
- Support secure token generation, rotation, revocation, expiration, audit trail, and scoped permissions
- Distinguish between:
  - Human access tokens
  - Service account / machine-to-machine tokens
  - Short-lived delegated tokens
- Include token scopes such as:
  - clusters:read
  - tests:read
  - tests:create
  - tests:update
  - tests:launch
  - schedules:create
  - logs:read
  - metrics:read
  - users:read
  - users:manage
  - admin:full
- Include best-practice design for personal access tokens and service tokens
- Use least privilege and short lifetime by default
- Include token hashing/storage strategy and revocation model

Internal user management:
The app must include admin features for:
- Create internal users
- Invite users
- Activate/deactivate users
- Map users to teams
- Assign roles and scopes
- Set language preference and theme preference
- View login history and audit history
- Support future SCIM or external identity sync
- Clearly separate internal app users from Azure AD identity provider records

Multilingual and localization requirements:
- Design the application for full internationalization from day one
- All UI text, navigation, validation messages, audit labels, notifications, empty states, and settings pages must be translatable
- Use locale-aware routing and translation loading strategy
- Support left-to-right and right-to-left layouts
- Hebrew must render correctly with RTL layout
- Date, time, number, and timezone formatting must be locale-aware
- Support fallback language strategy
- Include translation key architecture and content governance approach
- Explain how API error messages and exported reports can be localized

Theme requirements:
- Support light, dark, and system theme
- Persist user preference in profile settings and also support pre-login default via system theme
- Ensure all dashboards, charts, tables, log viewers, and forms are optimized for both light and dark themes
- Define theme token architecture for enterprise design systems
- Prevent flash of incorrect theme on first load
- Include accessibility and contrast requirements for both themes

Application scope:
The platform should allow users to:
- Sign in with Azure AD SSO
- Manage internal users and roles
- View all accessible AWS accounts and EKS clusters
- Register, sync, and monitor multiple EKS clusters
- Browse namespaces, deployments, pods, jobs, cronjobs, services, ingress, and events
- Launch k6 performance tests on selected clusters
- Schedule recurring k6 tests through CronJobs
- View test runs, status, history, duration, and pass/fail SLO results
- Stream live pod/job logs in the UI
- Visualize live and historical k6 metrics from InfluxDB
- Compare metrics across clusters, environments, accounts, teams, and time ranges
- Control access by role, team, account, cluster, namespace, and action
- Audit all user and system actions
- Use API tokens to automate listing, creating, defining, and launching tests

Core functional requirements:
- Support many AWS accounts and many EKS clusters
- Support environment grouping: dev, stage, prod, sandbox
- Support cluster tagging and ownership metadata
- Discover clusters automatically or via onboarding workflow
- Per-cluster connectivity status and health checks
- Kubernetes resource explorer with searchable filters
- k6 test template library
- k6 script versioning
- Run tests from Git, ConfigMap, or stored templates
- Run one-off Job or scheduled CronJob
- Capture execution metadata: who ran it, where, when, git revision, test version, env vars, target URL
- Store test results metadata in app DB
- Stream test metrics to InfluxDB
- Display dashboards for latency, throughput, error rate, VUs, checks, thresholds
- Correlate test runs with logs and cluster events
- Offer export to CSV/JSON/PDF for reports
- Provide notifications for failures and threshold breaches
- Provide admin pages for cluster onboarding, role mapping, SSO settings, token settings, retention policies, localization settings, and feature flags

Authentication and authorization:
- Use Azure AD as the main identity provider via OIDC
- Implement enterprise SSO with support for groups/claims mapping
- Support role-based and attribute-based access control
- Enforce least privilege
- Separate platform admin, security auditor, cluster operator, developer, QA/performance engineer, service user, and read-only viewer roles
- Support per-account, per-cluster, and per-namespace permissions
- Include session security, token rotation, short-lived credentials, and audit logging
- Design for future SCIM provisioning support

AWS and Kubernetes integration:
- The platform must work across multiple AWS accounts
- Assume cross-account role access from a central control plane account
- Use secure role assumption patterns, no long-lived static credentials
- Show how the app connects to many EKS clusters safely
- Describe cluster registration, trust model, and credential brokering
- Explain whether to use direct Kubernetes API access, agents, or hybrid model
- Compare the tradeoffs and choose the best design
- Include support for private clusters
- Include network architecture options for VPC peering / Transit Gateway / PrivateLink / bastionless access
- Describe how live log streaming from Kubernetes pods/jobs should work

k6 and performance testing:
- Integrate k6 test execution in Kubernetes
- Support running tests as Job and CronJob
- Consider using k6 operator where appropriate
- Support custom k6 images for extensions such as InfluxDB output
- Store script metadata, test definitions, schedules, thresholds, and results
- Build reusable test templates with variables
- Include concurrency control, quotas, retries, cancellation, and cleanup
- Show how to stream logs and test status in real time
- Include retention strategy for test artifacts and metrics

InfluxDB and observability:
- Integrate with InfluxDB for live k6 metrics
- Show schema / measurement strategy
- Support dashboard views per run, per cluster, per account, and fleet-wide
- Explain how real-time metric updates reach the frontend
- Include alerting strategy
- Include data retention and downsampling strategy
- Also include app metrics, audit events, and operational telemetry
- Correlate logs, metrics, and test runs in a single investigation workflow

Real-time UX requirements:
- Live logs panel with tail/follow mode, search, severity highlighting, reconnect behavior, and backpressure handling
- Live metrics panels fed from InfluxDB or a backend aggregation layer
- Near real-time status updates for running jobs and cronjobs
- WebSocket or Server-Sent Events architecture with explanation
- Handle fan-out, scale, and reconnect gracefully

Frontend requirements:
- Generate a modern enterprise-grade web app UI
- The UX must look like a serious internal platform, not a marketing site
- Use a professional design system with light/dark/system mode
- Compact dashboard typography suitable for dense operational screens
- Full multilingual UI and RTL support for Hebrew
- Information architecture should include:
  - Global fleet overview
  - AWS accounts view
  - Clusters view
  - Cluster detail
  - Namespace explorer
  - Workloads
  - Jobs / CronJobs
  - k6 test library
  - Test definition editor
  - Test runner
  - Live run console
  - Metrics dashboard
  - API token management
  - Internal users and roles
  - Audit logs
  - Admin settings
- Include command palette, filters, saved views, breadcrumbs, bulk actions, and export
- Support responsive behavior but optimize for desktop operations teams
- Use clear states for loading, empty, error, partial, stale, and disconnected

Preferred technology direction:
- Frontend: Next.js + TypeScript + next-intl or equivalent enterprise i18n approach
- Backend: NestJS or Go for APIs and orchestration
- Real-time layer: WebSockets and/or SSE
- Persistence: PostgreSQL for metadata, InfluxDB for time series
- Caching/queues: Redis and background workers
- IaC: Terraform
- Deployment target: EKS
- Identity: Azure AD OIDC
- Observability: OpenTelemetry-compatible design
You may propose better alternatives, but justify them.

Non-functional requirements:
- High availability
- Horizontal scalability
- Multi-region-ready architecture
- Auditability
- Strong security controls
- Low operational overhead
- SLO-oriented design
- Support thousands of test runs and many concurrent users
- Graceful degradation under failure
- Cost-aware architecture

Security requirements:
- No hard-coded secrets
- Use secret management and short-lived credentials
- Encrypt data in transit and at rest
- Strong tenant isolation model
- CSRF/XSS/SSRF protection
- Secure webhook and callback handling
- Approval workflow for dangerous actions in production
- Full audit trails for login, role change, cluster access, token issuance, test creation, schedule creation, launch, cancellation, and admin actions
- Include threat modeling for cluster credentials, token abuse, data leakage, and cross-account compromise

Design deliverable format:
Produce the answer in these sections:
A. Executive summary
B. Assumptions
C. High-level architecture
D. Detailed component architecture
E. Identity and access model
F. Internal user management model
G. API token model
H. Internationalization and localization model
I. Theme system model
J. Multi-account / multi-cluster connectivity model
K. k6 execution architecture
L. InfluxDB data flow and visualization model
M. Live logs and real-time events architecture
N. API and event contract examples
O. UI information architecture and screen breakdown
P. Recommended database schema
Q. Deployment and DevOps model
R. Security and compliance controls
S. Reliability, scaling, and performance strategy
T. Testing strategy
U. MVP plan
V. Phase 2 enterprise enhancements
W. Example monorepo structure
X. Starter code skeletons

Also generate:
- A Mermaid architecture diagram
- A Mermaid sequence diagram for launching a k6 run
- A Mermaid sequence diagram for live log streaming
- Example PostgreSQL schema
- Example Kubernetes CRD/job payloads or API payloads
- Example RBAC matrix
- Example REST endpoints for listing, creating, defining, and launching tests
- Example token generation and rotation flows
- Example WebSocket event contracts
- Example Terraform module structure
- Example CI/CD workflow
- Example risk register with mitigations

Code generation expectations:
Where useful, generate starter code skeletons for:
- Frontend app shell
- Backend API modules
- Auth middleware
- Token issuance and validation service
- Internal user management module
- EKS cluster connector abstraction
- Live logs gateway
- k6 run orchestrator
- InfluxDB query service
- Audit logging module
- Localization framework structure
- Theme provider
- Terraform layout
- Helm chart layout

Architecture guidance:
- Prefer a control-plane architecture with clean separation between UI, API, orchestration, real-time gateway, metadata store, and cluster access layer
- Explain whether per-cluster agent is required or optional
- Include a strong recommendation and justify it
- Optimize for secure access to private EKS clusters
- Assume enterprise governance and change management requirements
- Design for future plugin extensibility

Quality bar:
The result must read like something a staff engineer or platform architect would present for implementation approval.
Avoid generic startup-style fluff.
Be specific, structured, and implementation-oriented.

Before finalizing the design:
- List the 5 hardest architectural risks
- Explain the mitigation for each risk
- Identify the top 10 MVP endpoints
- Show sample API payloads for create test definition, launch test, list runs, and generate token