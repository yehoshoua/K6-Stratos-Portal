## ADDED Requirements

### Requirement: Interactive K6 Thresholds Editor
The system SHALL provide a form-based thresholds editor in the K6 Test Wizard that enables users to visually configure metric thresholds (e.g., http_req_duration < 200).

#### Scenario: Visual threshold configuration
- **WHEN** the user selects a metric, operator, and target value in the thresholds editor
- **THEN** the system SHALL serialize this configuration into the target K6 script options block.
