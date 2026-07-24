## Why

The K6 Stratos Portal currently provides essential load-testing and Kubernetes cluster management capabilities. However, as teams scale, they require advanced performance diagnostics (metric comparisons), simplified configurations (threshold and code editor enhancements), automated maintenance (EKS addon upgrades), and enterprise-ready collaboration features (workspaces and RBAC).

Implementing these premium capabilities will elevate the portal's user experience to be state-of-the-art, visually striking, and functionally complete.

## What Changes

- **Test Runs & Analytics**:
  - Add a metrics comparison page to evaluate historical executions.
  - Implement real-time resource utilization monitoring for runner pods.
- **Test Creation & Scripting**:
  - Integrate Monaco Editor for rich scripting with syntax highlighting and auto-completion.
  - Build a visual K6 thresholds editor and file-upload manager for dataset parameters (CSV/JSON).
- **Cluster & Operations Management**:
  - Introduce EKS managed addon upgrades directly via the cluster dashboard.
- **Scheduling**:
  - Build an interactive scheduler calendar to track and schedule load tests.
- **Enterprise Controls**:
  - Restructure portal resources into isolated workspaces and enforce role-based access control.

## Capabilities

### New Capabilities
- `metrics-comparer`: Compare multiple historical K6 execution metrics side-by-side.
- `thresholds-editor`: Define and configure K6 threshold criteria in the wizard.
- `monaco-editor`: Use a rich code editor with auto-completion and syntax linting for scripts.
- `file-upload`: Upload and bind variable files (CSV/JSON) to K6 execution runs.
- `eks-addon-upgrader`: Directly upgrade recommended AWS EKS add-on versions from the Clusters page.
- `live-resource-stats`: Query and view real-time resource usage statistics of K8s runner pods.
- `cron-ui-calendar`: View and manage K6 schedule execution plans in an interactive calendar view.
- `workspaces-rbac`: Group clusters and tests into workspaces with user role authentication and controls.

### Modified Capabilities
<!-- None -->

## Impact

- **Frontend**: Adds multiple new views (Workspaces, Calendar, Compare), updates wizard forms, and replaces basic textareas with Monaco Editor.
- **Backend API**: New routes for EKS addon upgrades, runner pod resource metrics, file upload storage, and workspace-based auth middleware.
- **Database**: Extends relational schema to support workspaces, workspace-resource mapping, and file metadata.
