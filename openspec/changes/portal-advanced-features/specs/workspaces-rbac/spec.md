## ADDED Requirements

### Requirement: Workspace Isolation and Role-Based Access Controls
The system SHALL support creating logical workspaces (e.g., "Development", "Production-Billing"), assigning Kubernetes clusters and templates to specific workspaces, and enforcing user-role scopes ('viewer', 'editor', 'administrator') at the workspace level.

#### Scenario: Unauthorized access to cluster resource
- **WHEN** a user with the 'viewer' role in a workspace attempts to delete a cluster assigned to that workspace
- **THEN** the system SHALL block the request and return an HTTP 403 Forbidden error.
