## ADDED Requirements

### Requirement: Real-time Runner Resource Utilization Metrics
The system SHALL poll the Kubernetes Metrics API (metrics.k8s.io) to extract live CPU and Memory utilization values of the running K6 runner pods, rendering them in a dedicated telemetry panel during active test runs.

#### Scenario: Telemetry rendering during active run
- **WHEN** a test execution is in the "running" state
- **THEN** the system SHALL render real-time CPU/Memory charts using values fetched from the metrics endpoint.
