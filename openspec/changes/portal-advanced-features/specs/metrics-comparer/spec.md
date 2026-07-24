## ADDED Requirements

### Requirement: Compare Historical Executions
The system SHALL support selecting up to 4 historical K6 exéctutions and rendering their performance metrics (Request Rate, Error Rate, and p95/p99 Latency) on a single comparative dashboard.

#### Scenario: Compare multiple runs
- **WHEN** the user selects three completed runs on the Runs list page and clicks "Compare"
- **THEN** the system SHALL navigate to the comparison dashboard showing overlayed chart series for each selected execution.
