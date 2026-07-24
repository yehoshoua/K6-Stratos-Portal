## ADDED Requirements

### Requirement: EKS Addon Version Upgrades
The system SHALL support triggering AWS EKS managed addon version updates directly from the recommendations UI on the K8s Clusters dashboard.

#### Scenario: Upgrade a recommended addon version
- **WHEN** the user clicks the "Upgrade" action for the `kube-proxy` addon
- **THEN** the system SHALL invoke the EKS UpdateAddon API to upgrade the addon to the recommended target version.
