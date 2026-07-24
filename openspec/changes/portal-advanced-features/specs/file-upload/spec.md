## ADDED Requirements

### Requirement: Variable File Binding
The system SHALL allow users to upload parameter data files (CSV/JSON) in the Test Wizard, store them securely in the backend, and inject them as configuration files in the runner container.

#### Scenario: Bind dataset to test execution
- **WHEN** the user uploads a `users.csv` file in the wizard and clicks launch
- **THEN** the system SHALL create a Kubernetes ConfigMap containing the CSV content and mount it to the runner pod at `/datasets/users.csv`.
