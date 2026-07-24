## Context

The K6 Stratos Portal needs to support advanced diagnostic and enterprise-grade multi-tenancy capabilities. Since the application handles heavy load-testing metric storage (in InfluxDB), orchestrates Kubernetes pods (runners/TestRuns), and authenticates users via SSO, the implementation requires a consistent architectural approach.

## Goals / Non-Goals

**Goals:**
- Provide highly responsive, premium visual components (visual calendars, metrics comparers, rich code editors).
- Securely isolate and authorize workspace-level resources.
- Direct integration with native Kubernetes metrics APIs and AWS EKS APIs.

**Non-Goals:**
- Building a full CI/CD runner orchestration engine (leveraging existing K6 operators instead).
- Multi-region AWS deployment configuration.

## Decisions

### 1. Scripting Engine: Monaco Editor Integration
- **Choice**: Integrate `@monaco-editor/react`.
- **Rationale**: Replaces raw textarea with a modern IDE experience. Supports auto-completion of K6 core modules (e.g., `import http from 'k6/http'`) using custom-defined TypeScript definition files (`d.ts`) loaded dynamically into Monaco's virtual file system.

### 2. Multi-Tenancy: Workspaces and RBAC
- **Choice**: Database schema extensions with workspace context middleware.
- **Rationale**: Introduce a `workspaces` table and map all cluster registrations, templates, and execution history. Backend API handlers parse the requesting user's claims and enforce authorization using middleware before serving any workspace-owned resources.

### 3. File Parameters: ConfigMap Binding
- **Choice**: Store files on disk/DB and inject them via Kubernetes ConfigMaps.
- **Rationale**: Uploaded files (like `data.csv`) are converted to ConfigMap manifests by the backend and mounted directly to the target runner container at `/datasets/<filename>`.

### 4. Telemetry: Kubernetes Metrics Server API
- **Choice**: Poll the Kubernetes metrics API `/apis/metrics.k8s.io/v1beta1/pods` directly.
- **Rationale**: Avoids the need for installing a heavy Prometheus agent inside customer clusters. Telemetry details are fetched dynamically via client-go and streamed back to the frontend.

## Risks / Trade-offs

- **[Risk] Monaco Editor Loading Delay** → *Mitigation*: Dynamically import Monaco Editor with a sleek loading fallback spinner to keep LCP times low.
- **[Risk] ConfigMap Size Limit (1MB)** → *Mitigation*: Limit uploaded parameter files to 1MB. Recommend S3 storage for files exceeding the size limit.
