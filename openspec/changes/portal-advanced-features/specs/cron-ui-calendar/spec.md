## ADDED Requirements

### Requirement: Interactive Schedules Calendar UI
The system SHALL display an interactive monthly/weekly calendar rendering active schedules, past executions, and upcoming scheduled K6 test run slots.

#### Scenario: Navigating planned executions calendar
- **WHEN** the user opens the "Schedules" calendar view
- **THEN** the system SHALL calculate the next execution time occurrences for all active cron definitions and overlay them as calendar events.
