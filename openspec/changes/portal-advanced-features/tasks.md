## 1. Database & Backend Foundations

- [x] 1.1 Extend database schema with `workspaces`, `workspace_users`, and resources associations.
- [x] 1.2 Implement workspace-level authentication and authorization middleware in Go backend.
- [x] 1.3 Create backend multi-part file upload API endpoint for dataset variable files.
- [x] 1.4 Implement telemetry API querying live CPU/Memory utilization from Kubernetes Metrics Server API.
- [x] 1.5 Implement EKS Addon Upgrader handler using AWS EKS SDK `UpdateAddon`.

## 2. Frontend Components & Views

- [x] 2.1 Integrate `@monaco-editor/react` inside the Test Wizard step 2.
- [x] 2.2 Define and register custom autocomplete type declarations (`d.ts`) for Monaco Editor to recognize K6 module signatures.
- [x] 2.3 Build the interactive monthly/weekly Schedule Calendar component.
- [x] 2.4 Build the Metrics Comparison dashboard view with overlayed chart comparisons using Recharts.
- [x] 2.5 Implement the visual K6 Thresholds Editor form fields inside the Test Wizard.

## 3. Integration & Manifest Mounting

- [x] 3.1 Build dataset ConfigMap creation logic in Go backend to mount uploaded files to runners.
- [x] 3.2 Add EKS addon upgrade action buttons to the recommendations section on Clusters page.
- [x] 3.3 Set up live telemetry graphs using WebSocket or polling streams on the active test run details page.
- [x] 3.4 Support switching workspaces context via a workspace selector dropdown in the Sidebar.
