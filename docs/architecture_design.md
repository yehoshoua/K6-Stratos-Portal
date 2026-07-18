# K6 Stratos Enterprise Control Plane - Architecture & Specification

This document details the production-grade architecture blueprint for elevating **K6 Stratos** into a secure-by-default, multi-tenant, multi-account centralized platform control plane.

---

## A. Executive Summary

The **K6 Stratos Enterprise Control Plane** is a unified, secure-by-default portal designed for centralizing multi-account Amazon EKS fleet operations and automating distributed load testing using the k6 Operator. Operating as an API-first, self-hosted control plane, it replaces decentralized developer commands with a single pane of glass. 

The system leverages cross-account AWS IAM roles, integrates with Azure AD SSO via OIDC, implements a cryptographic API token framework, and features a real-time streaming engine for logs and InfluxDB time-series performance metrics.

---

## B. Assumptions

1. **AWS Infrastructure:** A central control plane AWS account is designated to run the K6 Stratos platform. All managed clusters reside in separate target AWS accounts, each configured with an IAM role allowing cross-account assumption from the control plane account.
2. **Kubernetes API Access:** EKS cluster endpoints are reachable by the backend control plane. For private-only clusters, connectivity is established via AWS PrivateLink, Transit Gateway, or an HTTPS egress proxy.
3. **Identity Provider:** Azure AD (Microsoft Entra ID) is the single source of truth for corporate credentials, with groups mapped to platform roles via OIDC claims.
4. **Metrics Sink:** Distributed k6 pods push raw test metrics directly to an active InfluxDB cluster (v2.x) using the native InfluxDB output extension.
5. **Database:** Postgres is selected as the production database, replacing local SQLite configurations for high availability and data durability.

---

## C. High-Level Architecture

```mermaid
graph TB
    subgraph Client Layer
        Browser["User Browser (Next.js / i18n)"]
        CI["CI/CD Runner (GitHub Actions / GitLab)"]
    end

    subgraph Security Boundary
        Caddy["Caddy Proxy (TLS / Reverse Proxy)"]
    end

    subgraph Control Plane Account
        Backend["Go REST API & Gateway Engine"]
        Postgres[("PostgreSQL Metadata Store")]
        Redis[("Redis Queue / Cache")]
        Worker["Background Cron/Job Scheduler"]
    end

    subgraph Corporate Identity
        AzureAD["Azure AD OIDC / Entra ID"]
    end

    subgraph AWS Account A (Target)
        EKS_A["EKS Cluster A (Private)"]
        InfluxDB_A[("InfluxDB Cluster")]
    end

    subgraph AWS Account B (Target)
        EKS_B["EKS Cluster B (Public)"]
    end

    %% Client Interactions
    Browser -->|HTTPS / WSS| Caddy
    CI -->|REST API + Token| Caddy
    Caddy -->|/api/* /ws| Backend

    %% Backend Integrations
    Backend -->|OIDC Protocol| AzureAD
    Backend -->|Read/Write| Postgres
    Backend -->|Cache/Queue| Redis
    Worker -->|Assume STS Role| EKS_A
    Worker -->|Assume STS Role| EKS_B
    
    %% K6 Operator & Metrics
    Backend -->|Deploy Job/CRD| EKS_A
    Backend -->|Deploy Job/CRD| EKS_B
    EKS_A -.->|Metrics Push| InfluxDB_A
    Backend -->|Flux Queries| InfluxDB_A
```

---

## D. Detailed Component Architecture

1. **Caddy Edge Proxy:** Handles TLS termination and distributes incoming routes. Requests to `/api/*` and `/ws` are forwarded to the Go backend; all other requests serve the Next.js static output.
2. **Go REST API & Gateway Engine (Backend):** Built using a clean architecture pattern. Components include:
   * **API Handlers:** Expose RESTful endpoints and validate inputs.
   * **Authentication Middleware:** Processes JWT session tokens and `stratum_tok_` API headers.
   * **EKS Connector Service:** Assumes cross-account AWS IAM roles, constructs kubernetes-client configurations, and executes CRUD operations on resource definitions (Jobs, CronJobs, ConfigMaps, and TestRun CRDs).
   * **Live Stream Gateway:** Upgrades HTTP connections to WebSockets or SSE for multiplexing logs and metrics.
3. **Background Worker Engine:** A distributed queue runner utilizing Redis. Handles background health checks, automated schedule synchronization, and resource cleanup tasks.
4. **PostgreSQL Database:** Stores structured platform configurations: cluster profiles, k6 templates, schedules, internal users, roles, and audit trails.
5. **InfluxDB Time-Series Database:** Serves as the high-throughput metrics sink. k6 runner pods output metrics directly to InfluxDB, which the platform queries to display latency, throughput, and virtual user (VU) dashboards.

---

## E. Identity and Access Model

The system implements OIDC SSO via Azure AD as the corporate identity source, with local fallback for internal administrators and machine accounts.

```
                  SSO Azure AD Authentication & RBAC Flow
                  
   +---------+        +--------------+        +------------+        +--------------+
   | Browser |        | Stratos Auth |        |  Azure AD  |        | Postgres DB  |
   +----+----+        +------+-------+        +-----+------+        +------+-------+
        |                    |                      |                      |
        | 1. Click Login     |                      |                      |
        |------------------->|                      |                      |
        |                    | 2. Redirect (OIDC)   |                      |
        |<-------------------|--------------------->|                      |
        |                    |                      |                      |
        | 3. Authenticate & Approve                 |                      |
        |------------------------------------------>|                      |
        |                    |                      |                      |
        | 4. Authorization Code (Callback)          |                      |
        |------------------->|                      |                      |
        |                    | 5. Token Exchange    |                      |
        |                    |--------------------->|                      |
        |                    |                      |                      |
        |                    | 6. Tokens & ID Claims|                      |
        |                    |<---------------------|                      |
        |                    |                                             |
        |                    | 7. Query User Profile & Roles               |
        |                    |-------------------------------------------->|
        |                    |                                             |
        |                    | 8. Return Roles (Admin/Editor/Viewer)       |
        |                    |<--------------------------------------------|
        |                    |                                             |
        | 9. Set JWT Cookie  |                                             |
        |<-------------------|                                             |
```

### RBAC Hierarchy and Scope Mapping Matrix

| Role | Permitted Actions | Resource Boundary |
|---|---|---|
| **Platform Administrator** (`admin:full`) | Full CRUD on users, settings, clusters, tokens, and templates | Fleet-wide (All environments, all namespaces) |
| **Security Auditor** (`audit:read`) | Read-only access to audit logs, SSO settings, and system activities | Fleet-wide |
| **Cluster Operator** (`clusters:manage`) | Register clusters, edit namespace whitelists, adjust default settings | Limited to assigned AWS Account/Clusters |
| **Developer** (`tests:create`, `tests:launch`) | Create templates, edit ConfigMap scripts, trigger runs, view logs | Allowed in `dev` and `stage` environments |
| **QA / Performance Engineer** | Create, schedule, edit, and launch tests. Review historical metrics | Allowed in all environments, including `prod` |
| **Service User / Machine** | Launch specific tests via API tokens | Restricted to token scopes (e.g. `tests:launch`) |
| **Read-Only Viewer** (`*:read`) | Read-only views of dashboards, logs, and templates | Assigned namespaces/clusters |

---

## F. Internal User Management Model

Internal user records are managed independently of Azure AD identity records to support emergency administration accounts and system integrations.

* **Profile Fields:** Includes `username`, `email`, `role`, `status` (active/inactive/invited), `language_preference`, `theme_preference`, `team_memberships` (JSON array), and `created_at`.
* **Invite Workflow:** Administrators invite users by generating a one-time onboarding token. When the user visits the portal, they complete registration and verify their profile.
* **Audit Logging:** Every user modification, status change, and role assignment is logged in the `audit_logs` database table with the source user, timestamp, IP address, and target payload.
* **SCIM Compatibility:** Designed with structural hook columns to support future SCIM identity synchronization (e.g., `external_id` mapping to Azure AD User Principal Names).

---

## G. API Token Model

API tokens are designed for secure programmatic automation (e.g., CI/CD pipelines). They skip session cookies, requiring bearer authorization headers: `Authorization: Bearer stratum_tok_...`.

* **Token Hashing Strategy:** Plaintext tokens are never stored in the database. When a token is generated, the plaintext is presented to the user **once** (`stratum_tok_abcdef...`). The backend computes a SHA-256 hash of the token and stores it in the `api_tokens` table. Incoming request tokens are hashed and compared in constant-time.
* **Scopes:** Restricts access using explicit, fine-grained scopes (e.g., `tests:create`, `tests:launch`, `logs:read`, `metrics:read`).

---

## H. Internationalization and Localization Model

* **Architecture:** Uses a context-based localization provider (`next-intl` on Next.js, and a central middleware mapping on Go APIs).
* **Supported Locales:** English (`en`), French (`fr`), Spanish (`es`), German (`de`), Hebrew (`he`), and Chinese (`zh`).
* **Directionality (RTL/LTR):** The frontend detects active locale metadata and automatically applies the `dir="rtl"` attribute to the app wrapper when Hebrew (`he`) is active. Styling uses logical CSS properties (e.g., `margin-inline-start` instead of `margin-left`) to render the UI correctly in RTL and LTR.

---

## I. Theme System Model

The system utilizes custom CSS variables to support light, dark, and system-level themes without screen flickering.

* **Flicker Prevention:** A small, blocking script is injected at the very top of `index.html` (in the `<head>` block). It reads the theme from `localStorage` or queries the media query preference `(prefers-color-scheme: dark)` and applies the matching class (`light` or `dark`) to the document root before the HTML renders.

---

## J. Multi-Account / Multi-Cluster Connectivity Model

* **AWS STS AssumeRole Pattern:** No static AWS credentials (access keys) are stored for target EKS clusters. The control plane backend runs under an IAM execution role. When connecting to EKS in Account `B`, it calls `sts:AssumeRole` targeting the pre-configured role `arn:aws:iam::AccountB:role/StratosClusterOperatorRole`. The temporary credentials returned are used to sign requests to the target EKS API server.
* **Security & Network Isolation:** EKS endpoints are queried securely using HTTPS with TLS server verification. Connections route through a central VPC via AWS Transit Gateway or dedicated AWS PrivateLink VPC endpoints.

---

## K. k6 Execution Architecture

k6 performance tests are executed natively on Kubernetes as batch Jobs or CronJobs.

* **Job and CronJob Specs:** For schedules, the backend creates a standard Kubernetes `CronJob` (`batch/v1`). For one-off executions, it creates a Kubernetes `Job` (`batch/v1`).
* **Script Mounts:** The javascript test scripts are saved into a Kubernetes `ConfigMap` within the target namespace. The Job spec mounts this ConfigMap as a file inside the k6 container.
* **Quotas & Resource Controls:** Specs enforce CPU requests/limits, memory limits, and parallelism parameters to prevent resource starvation in target clusters.

---

## L. InfluxDB Data Flow and Visualization Model

1. **Metrics Ingestion:** Distributed k6 runner pods output metrics directly to the designated InfluxDB target server using the `--out xk6-influxdb` flag during execution.
2. **Dashboard Query Flow:** The Go backend queries InfluxDB using Flux (v2 API) or SQL/InfluxQL (v1 API) to aggregate statistics (VUs, HTTP Request Duration, throughput, error rates).
3. **SSE Real-Time Push:** The backend uses Server-Sent Events (SSE), querying InfluxDB every 5 seconds and flushing the data stream to clients.

---

## M. Live Logs and Real-Time Events Architecture

* **Streaming Mechanism:** Logs are fetched from the Kubernetes CoreAPI via Go's `client-go` using `GetLogs(podName, &corev1.PodLogOptions{Follow: true, TailLines: &100})`.
* **Backpressure Management:** The backend buffers log lines in a Ring Buffer and drops older lines if the client connection lags, preventing memory bloat.
* **Automatic Reconnect:** The Next.js frontend monitors the stream connection. If disconnected, it triggers a linear backoff retry to restore the log console.

---

## N. API and Event Contract Examples

### 1. Create Test Definition Payload (`POST /api/v1/tests`)
```json
{
  "name": "E-Commerce Gateway Load Test",
  "template_id": "tpl-ecommerce-gateway-01",
  "cluster_id": "eks-prod-uswest2-01",
  "namespace": "performance-testing",
  "parallelism": 10,
  "cpu_limit": "2000m",
  "memory_limit": "4Gi",
  "runner_image": "123456789012.dkr.ecr.us-west-2.amazonaws.com/k6-custom-runner:v1.20",
  "script_content": "import http from 'k6/http'; export default function() { http.get('https://api.stratos-retail.com/v1/products'); }",
  "sla_thresholds": "http_req_duration{status:200}<500,http_req_failed<0.01"
}
```

### 2. Generate API Token Payload (`POST /api/v1/tokens`)
```json
{
  "name": "GitHub Actions CI Token",
  "role": "editor",
  "scopes": ["tests:create", "tests:launch", "logs:read"],
  "expires_in_days": 30
}
```

---

## O. UI Information Architecture and Screen Breakdown

* **Global Fleet Dashboard:** High-level metrics showing total registered AWS accounts, online EKS clusters, running k6 pods, active schedules, and active threshold alerts.
* **AWS Accounts View:** Registry of managed AWS accounts with connection configurations, STS assume roles, and IAM synchronization status.
* **Cluster Detail & Namespace Explorer:** Dynamic file-explorer style interface listing pods, services, jobs, cronjobs, ingress rules, and active TestRun CRDs.
* **K6 Test Templates Library:** Reusable test scripts and template configurations, supporting variables and SLA settings.
* **Live Run Console:** Real-time log console drawer with pause/resume controls, search filters, log highlighting, and split-screen charts displaying InfluxDB metric graphs.

---

## P. Recommended Database Schema

```sql
-- PostgreSQL Production Schema

CREATE TYPE platform_role AS ENUM ('administrator', 'editor', 'viewer', 'security_auditor');
CREATE TYPE user_status AS ENUM ('invited', 'active', 'inactive');

CREATE TABLE aws_accounts (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    iam_role_arn VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clusters (
    id VARCHAR(50) PRIMARY KEY,
    aws_account_id VARCHAR(50) REFERENCES aws_accounts(id),
    name VARCHAR(100) NOT NULL,
    api_server_url VARCHAR(255) NOT NULL,
    ca_cert_base64 TEXT NOT NULL,
    namespaces TEXT[], -- Whitelisted namespaces
    region VARCHAR(50) NOT NULL,
    environment VARCHAR(20) CHECK (environment IN ('dev', 'stage', 'prod', 'sandbox')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(64), -- Null for SSO-only users
    salt VARCHAR(32),
    role platform_role NOT NULL DEFAULT 'viewer',
    status user_status NOT NULL DEFAULT 'invited',
    language_preference VARCHAR(5) DEFAULT 'en',
    theme_preference VARCHAR(10) DEFAULT 'system',
    team_memberships JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    role platform_role NOT NULL DEFAULT 'viewer',
    scopes VARCHAR(50)[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);
```

---

## Q. Deployment and DevOps Model

* **Target Destination:** Deployed to Amazon EKS within the central control plane AWS account.
* **Helm Deployment Architecture:** The control plane is packaged as a Helm chart deploying Caddy (ingress/proxy), the Go API server (deployment), PostgreSQL (StatefulSet or AWS RDS instance), and Redis.
* **Infrastructure as Code (IaC):** Set up using Terraform. Resources generated include EKS clusters, AWS IAM cross-account roles, Amazon ECR registries, RDS instances, and security groups.

---

## R. Security and Compliance Controls

* **Zero Static Keys:** The platform uses EKS IAM Roles for Service Accounts (IRSA) to obtain AWS STS tokens.
* **Secrets Management:** Kubeconfig details, certificates, and tokens are stored in AWS Secrets Manager and retrieved dynamically at runtime.
* **Input Sanitization:** Go backend utilizes parameterized DB queries and strictly validates script payloads to mitigate SQL injection and remote code execution vulnerabilities.

---

## S. Reliability, Scaling, and Performance Strategy

* **Horizontal Pod Autoscaling (HPA):** The Go backend scales dynamically based on CPU/Memory thresholds.
* **Redis Caching:** API responses for cluster resource trees and active test run inventories are cached in Redis to decrease load on downstream Kubernetes API servers.
* **Graceful Degradation:** If InfluxDB is unavailable, tests continue to run. Metric visualization screens show warning states, but test control systems remain functional.

---

## T. Testing Strategy

1. **Unit Testing:** Focuses on auth middleware validations, token hashing checks, config parsers, and template builders.
2. **Integration Testing:** Tests EKS mock endpoints, database queries, and log stream flusher controllers.
3. **E2E Load Testing:** Uses k6 to run performance profiles on the control plane backend itself, evaluating WebSocket and SSE connection limits up to 5,000 concurrent clients.

---

## U. MVP Plan

* **Week 1-2:** Set up PostgreSQL database tables and deploy OIDC Azure AD authentication.
* **Week 3-4:** Implement the AWS STS cross-account assume-role engine and core EKS k8s connectors.
* **Week 5-6:** Build out k6 Job execution logic, ConfigMap management, and real-time log streaming.
* **Week 7-8:** Integrate InfluxDB SSE metrics visualization, complete testing validation, and package the Helm charts.

---

## V. Phase 2 Enterprise Enhancements

* **SCIM Directory Integration:** Real-time user sync with Microsoft Entra ID.
* **Cross-Cloud Support:** Extending Kubernetes orchestration capabilities to Azure AKS and Google GKE.
* **Automated SLO Assertions:** Evaluating test results against historical baselines and executing automated rollback actions for CI/CD deployments.
