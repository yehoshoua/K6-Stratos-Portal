## ADDED Requirements

### Requirement: Monaco Script Editor Integration
The system SHALL replace the standard script textarea in the Test Wizard with a Monaco Editor instance configured for JavaScript syntax highlighting, auto-completion of K6 module APIs, and inline static analysis warning messages.

#### Scenario: Script editor loading
- **WHEN** the user navigates to Step 2 "Load & Script" of the test wizard
- **THEN** the system SHALL initialize Monaco Editor pre-loaded with the current K6 script template.
