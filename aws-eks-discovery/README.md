# AWS Cross-Account EKS Cluster Auto-Discovery

This directory contains the configurations and the Go code to automatically discover Amazon EKS clusters across multiple AWS accounts and multiple regions. It strictly implements **least-privilege security**, filtering EKS clusters at the IAM level so only EKS clusters tagged with `k6s=enabled` can be described.

---

## 1. Architecture Overview

```
                      +-----------------------------+
                      | Stratos Portal Backend Pod  |
                      |   (Runs in Central Account) |
                      +--------------+--------------+
                                     |
                                     | (1) Read AWS_ACCOUNTS_DISCOVERY env
                                     v
                      +--------------+--------------+
                      |  discovery.DiscoverClusters |
                      +--------------+--------------+
                                     |
                +--------------------+--------------------+
                | (2) sts:AssumeRole |                    | (2) sts:AssumeRole
                v                                         v
   +------------+------------+               +------------+------------+
   | AWS Account Destination |               | AWS Account Destination |
   |      Account A          |               |      Account B          |
   | (StratosEKSDiscoveryRole)|              | (StratosEKSDiscoveryRole)|
   +------------+------------+               +------------+------------+
                |                                         |
    (3) list / describe clusters              (3) list / describe clusters
      (EKS Tag: k6s=enabled)                    (EKS Tag: k6s=enabled)
                |                                         |
                v                                         v
   +------------+------------+               +------------+------------+
   | EKS Cluster: my-staging |               | EKS Cluster: my-testing |
   |    (k6s=enabled tag)    |               |    (k6s=enabled tag)    |
   +-------------------------+               +-------------------------+
```

1. **Stratos Portal Backend** parses the `AWS_ACCOUNTS_DISCOVERY` environment variable.
2. For each account, the backend assumes the **`StratosEKSDiscoveryRole`** IAM role.
3. It initializes an EKS client for each specified region and lists EKS clusters.
4. It describes the EKS clusters. **The destination role's IAM policy rejects the DescribeCluster operation if the cluster is not tagged with `k6s=enabled`**, ensuring EKS clusters are filtered securely at the AWS network hardware level.

---

## 2. Environment Variable Specification

Define target AWS accounts and their respective target regions using the `AWS_ACCOUNTS_DISCOVERY` environment variable in the portal backend deployment:

```bash
AWS_ACCOUNTS_DISCOVERY="123456789012#us-east-1;us-west-2;eu-west-1;ap-south-1,34567890123#us-east-2"
# Optional — IAM role name assumed in each target account (default: StratosEKSDiscoveryRole)
AWS_ACCOUNTS_DISCOVERY_ROLE="StratosEKSDiscoveryRole"
# Optional — STS external ID for cross-account assume-role (default: StratosEKSDiscoveryExternalID)
AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID="StratosEKSDiscoveryExternalID"
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_ACCOUNTS_DISCOVERY` | Yes | — | Target accounts and regions (`AccountID#region1;region2,...`) |
| `AWS_ACCOUNTS_DISCOVERY_ROLE` | No | `StratosEKSDiscoveryRole` | IAM role name to assume in each target account |
| `AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID` | No | `StratosEKSDiscoveryExternalID` | STS external ID passed to `AssumeRole` |

### Format Syntax:
* Accounts are separated by commas (`,`).
* Within each account, the Account ID and the region list are separated by a hash (`#`).
* Regions are separated by semi-colons (`;`).

---

## 3. AWS IAM Configurations

### Source Account (Where the Portal Backend runs)
Attach the policy from `source-account-policy.json` to the Portal Backend's IAM Role (e.g. your EKS EKS-Pod IRSA role or EC2 Instance Profile):

* **File:** [source-account-policy.json](source-account-policy.json)
* **Action:** Allows the backend to perform `sts:AssumeRole` on the configured discovery role (default `StratosEKSDiscoveryRole`, overridable via `AWS_ACCOUNTS_DISCOVERY_ROLE`) in any external AWS account.

### Destination Accounts (Target/Satelite Accounts)
Create an IAM Role named **`StratosEKSDiscoveryRole`** (or the name set in `AWS_ACCOUNTS_DISCOVERY_ROLE`) in **each target AWS account**.

1. **Trust Policy (AssumeRolePolicyDocument):**
   * **File:** [destination-account-trust-policy.json](destination-account-trust-policy.json)
   * **Action:** Trusts the central Portal Backend's IAM Role ARN. We recommend configuring a `sts:ExternalId` (e.g. `StratosEKSDiscoveryExternalID`) to mitigate the confused deputy problem.

2. **Permission Policy (Permissions):**
   * **File:** [destination-account-permission-policy.json](destination-account-permission-policy.json)
   * **Action:** 
     * Allows listing all EKS clusters.
     * **Crucial Rule:** Allows `DescribeCluster` and `ListTagsForResource` **ONLY** when the cluster resource is tagged with `k6s=enabled`. Any other EKS cluster will throw an `AccessDenied` exception.

---

## 4. EKS Tagging

To allow EKS clusters to be discovered, ensure they are tagged inside AWS:

* **Tag Key:** `k6s`
* **Tag Value:** `enabled`

To tag an existing cluster via AWS CLI:
```bash
aws eks tag-resource \
  --resource-arn "arn:aws:eks:<region>:<account-id>:cluster/<cluster-name>" \
  --tags "k6s=enabled"
```

---

## 5. Integrating Discovery with the Stratos Portal Database

When EKS Discovery is run, it maps found clusters into database records with:
* `AuthType` = `"eks-assume-role"`
* `EncryptedData` = The target Role ARN (`arn:aws:iam::<AccountID>:role/StratosEKSDiscoveryRole`)
* `CACertBase64` = The base64-encoded Cluster CA cert.
* `APIServerURL` = The cluster endpoint.

To integrate this in the portal's `clusters.go` or background task scheduler, you can register EKS clusters dynamically using the Go `discovery.DiscoverEKSClusters` engine!
