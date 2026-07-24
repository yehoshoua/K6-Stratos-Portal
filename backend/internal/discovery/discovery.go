package discovery

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/eks"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// DiscoveredCluster represents an EKS cluster found during discovery
type DiscoveredCluster struct {
	Name         string `json:"name"`
	APIServerURL string `json:"api_server_url"`
	CACertBase64 string `json:"ca_cert_base64"`
	AWSAccountID string `json:"aws_account_id"`
	ARN          string `json:"arn"`
	Region       string `json:"region"`
	RoleARN      string `json:"role_arn"`
}

// AWSAccountConfig holds the parsed configuration for a target AWS account and its regions
type AWSAccountConfig struct {
	AccountID string   `json:"account_id"`
	Regions   []string `json:"regions"`
}

const (
	DefaultDiscoveryRoleName   = "StratosEKSDiscoveryRole"
	DefaultDiscoveryExternalID = "StratosEKSDiscoveryExternalID"
	EnvAccountsDiscovery       = "AWS_ACCOUNTS_DISCOVERY"
	EnvAccountsDiscoveryExtID  = "AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID"
	EnvAccountsDiscoveryRole   = "AWS_ACCOUNTS_DISCOVERY_ROLE"
)

// DiscoveryRoleName returns the IAM role name assumed in target AWS accounts.
// Override with AWS_ACCOUNTS_DISCOVERY_ROLE (default: StratosEKSDiscoveryRole).
func DiscoveryRoleName() string {
	if name := strings.TrimSpace(os.Getenv(EnvAccountsDiscoveryRole)); name != "" {
		return name
	}
	return DefaultDiscoveryRoleName
}

// DiscoveryRoleARN builds the full IAM role ARN for a target AWS account.
func DiscoveryRoleARN(accountID string) string {
	accountID = strings.TrimSpace(accountID)
	return fmt.Sprintf("arn:aws:iam::%s:role/%s", accountID, DiscoveryRoleName())
}

// DiscoveryExternalID returns the STS external ID used for cross-account assume-role.
func DiscoveryExternalID() string {
	if id := strings.TrimSpace(os.Getenv(EnvAccountsDiscoveryExtID)); id != "" {
		return id
	}
	return DefaultDiscoveryExternalID
}

// ParseAWSAccountsEnv parses the custom env var string format:
// "123456789012#us-east-1;us-west-2;eu-west-1;ap-south-1,34567890123#us-east-2"
func ParseAWSAccountsEnv(envVal string) ([]AWSAccountConfig, error) {
	if envVal == "" {
		return nil, nil
	}
	var configs []AWSAccountConfig
	accounts := strings.Split(envVal, ",")
	for _, accStr := range accounts {
		accStr = strings.TrimSpace(accStr)
		if accStr == "" {
			continue
		}
		parts := strings.Split(accStr, "#")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid AWS account discovery format (expected 'AccountID#region1;region2'): %s", accStr)
		}
		accountID := strings.TrimSpace(parts[0])
		regionsPart := strings.TrimSpace(parts[1])
		regions := strings.Split(regionsPart, ";")
		var cleanedRegions []string
		for _, r := range regions {
			cleaned := strings.TrimSpace(r)
			if cleaned != "" {
				cleanedRegions = append(cleanedRegions, cleaned)
			}
		}
		if accountID == "" || len(cleanedRegions) == 0 {
			return nil, fmt.Errorf("empty AWS account ID or regions in configuration: %s", accStr)
		}
		configs = append(configs, AWSAccountConfig{
			AccountID: accountID,
			Regions:   cleanedRegions,
		})
	}
	return configs, nil
}

// DiscoverEKSClusters runs cross-account assume-role discovery for all configured accounts and regions.
// It will only discover EKS clusters that have the tag 'k6s=enabled'.
func DiscoverEKSClusters(ctx context.Context, accounts []AWSAccountConfig, externalID string) ([]DiscoveredCluster, error) {
	// Initialize default AWS SDK configuration from current environment (e.g. EC2/EKS pod role)
	baseCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load default AWS configuration: %w", err)
	}

	stsClient := sts.NewFromConfig(baseCfg)
	var discovered []DiscoveredCluster
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, acc := range accounts {
		roleARN := DiscoveryRoleARN(acc.AccountID)

		// Discover clusters concurrently per account/region to maximize speed
		for _, r := range acc.Regions {
			wg.Add(1)
			go func(accountID, region, arn string) {
				defer wg.Done()

				log.Printf("[AWS Discovery] Assuming role %s in region %s...", arn, region)
				// 1. Assume the target account discovery role
				assumeInput := &sts.AssumeRoleInput{
					RoleArn:         aws.String(arn),
					RoleSessionName: aws.String("stratos-eks-discovery"),
					DurationSeconds: aws.Int32(900), // 15 mins minimum
				}
				if externalID != "" {
					assumeInput.ExternalId = aws.String(externalID)
				}

				assumed, err := stsClient.AssumeRole(ctx, assumeInput)
				if err != nil {
					log.Printf("[AWS Discovery] [ERROR] Failed to assume role for account %s in region %s: %v", accountID, region, err)
					return
				}

				// Create EKS client using assumed credentials with the target region
				assumedCfg, err := awsconfig.LoadDefaultConfig(ctx,
					awsconfig.WithRegion(region),
					awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
						*assumed.Credentials.AccessKeyId,
						*assumed.Credentials.SecretAccessKey,
						aws.ToString(assumed.Credentials.SessionToken),
					)),
				)
				if err != nil {
					log.Printf("[AWS Discovery] [ERROR] Failed to create EKS AWS config for account %s in region %s: %v", accountID, region, err)
					return
				}

				eksClient := eks.NewFromConfig(assumedCfg)

				// 2. List all EKS clusters in the target region
				listOut, err := eksClient.ListClusters(ctx, &eks.ListClustersInput{})
				if err != nil {
					log.Printf("[AWS Discovery] [ERROR] Failed to list EKS clusters in account %s, region %s: %v", accountID, region, err)
					return
				}

				for _, name := range listOut.Clusters {
					log.Printf("[AWS Discovery] Describing cluster %s in account %s, region %s...", name, accountID, region)

					// 3. Describe the EKS cluster (The IAM policy restricts this to clusters tagged k6s=enabled)
					descOut, err := eksClient.DescribeCluster(ctx, &eks.DescribeClusterInput{
						Name: aws.String(name),
					})
					if err != nil {
						// AccessDenied exception is expected and handled gracefully for clusters that do not carry the k6s=enabled tag
						if strings.Contains(err.Error(), "AccessDenied") {
							log.Printf("[AWS Discovery] Skipping cluster %s in account %s (Not authorized / No 'k6s=enabled' tag)", name, accountID)
						} else {
							log.Printf("[AWS Discovery] [ERROR] Failed to describe cluster %s in account %s, region %s: %v", name, accountID, region, err)
						}
						continue
					}

					cluster := descOut.Cluster
					// Double check tag filtering in code for extra safety
					tagValue, ok := cluster.Tags["k6s"]
					if !ok || tagValue != "enabled" {
						log.Printf("[AWS Discovery] Skipping cluster %s in account %s (Does not carry 'k6s=enabled' tag)", name, accountID)
						continue
					}

					log.Printf("[AWS Discovery] [SUCCESS] Found active EKS Cluster: %s in account %s, region %s", name, accountID, region)

					clusterARN := aws.ToString(cluster.Arn)
					resolvedAccountID := AccountIDFromARN(clusterARN)
					if resolvedAccountID == "" {
						resolvedAccountID = accountID
					}

					mu.Lock()
					discovered = append(discovered, DiscoveredCluster{
						Name:         name,
						APIServerURL: aws.ToString(cluster.Endpoint),
						CACertBase64: aws.ToString(cluster.CertificateAuthority.Data),
						AWSAccountID: resolvedAccountID,
						ARN:          clusterARN,
						Region:       region,
						RoleARN:      arn,
					})
					mu.Unlock()
				}
			}(acc.AccountID, r, roleARN)
		}
	}

	wg.Wait()
	return discovered, nil
}

// LookupClusterAWSAccount resolves the AWS account that owns an EKS cluster by
// matching its API server endpoint against clusters discovered via
// AWS_ACCOUNTS_DISCOVERY.
func LookupClusterAWSAccount(ctx context.Context, clusterName, apiServerURL, externalID string, accounts []AWSAccountConfig) string {
	clusterName = strings.TrimSpace(clusterName)
	apiServerURL = strings.TrimSpace(apiServerURL)
	if clusterName == "" || apiServerURL == "" || len(accounts) == 0 {
		return ""
	}

	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	baseCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return ""
	}
	stsClient := sts.NewFromConfig(baseCfg)

	for _, acc := range accounts {
		roleARN := DiscoveryRoleARN(acc.AccountID)
		for _, region := range acc.Regions {
			assumeInput := &sts.AssumeRoleInput{
				RoleArn:         aws.String(roleARN),
				RoleSessionName: aws.String("stratos-eks-account-lookup"),
				DurationSeconds: aws.Int32(900),
			}
			if externalID != "" {
				assumeInput.ExternalId = aws.String(externalID)
			}

			assumed, err := stsClient.AssumeRole(ctx, assumeInput)
			if err != nil {
				continue
			}

			assumedCfg, err := awsconfig.LoadDefaultConfig(ctx,
				awsconfig.WithRegion(region),
				awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
					aws.ToString(assumed.Credentials.AccessKeyId),
					aws.ToString(assumed.Credentials.SecretAccessKey),
					aws.ToString(assumed.Credentials.SessionToken),
				)),
			)
			if err != nil {
				continue
			}

			descOut, err := eks.NewFromConfig(assumedCfg).DescribeCluster(ctx, &eks.DescribeClusterInput{
				Name: aws.String(clusterName),
			})
			if err != nil || descOut.Cluster == nil {
				continue
			}
			if aws.ToString(descOut.Cluster.Endpoint) != apiServerURL {
				continue
			}
			if arn := aws.ToString(descOut.Cluster.Arn); arn != "" {
				if accountID := AccountIDFromARN(arn); accountID != "" {
					return accountID
				}
			}
			return acc.AccountID
		}
	}
	return ""
}

func AccountIDFromARN(arn string) string {
	arn = strings.TrimSpace(arn)
	if !strings.HasPrefix(arn, "arn:") {
		return ""
	}
	parts := strings.Split(arn, ":")
	if len(parts) < 5 {
		return ""
	}
	accountID := strings.TrimSpace(parts[4])
	if len(accountID) != 12 {
		return ""
	}
	for _, r := range accountID {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return accountID
}

// UpgradeClusterAddon upgrades an EKS-managed addon using AssumeRole AWS EKS SDK
func UpgradeClusterAddon(ctx context.Context, accountID, region, clusterName, addonName, recommendedVersion, externalID string) error {
	baseCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to load default AWS configuration: %w", err)
	}

	stsClient := sts.NewFromConfig(baseCfg)
	roleARN := DiscoveryRoleARN(accountID)

	assumeInput := &sts.AssumeRoleInput{
		RoleArn:         aws.String(roleARN),
		RoleSessionName: aws.String("stratos-eks-addon-upgrade"),
		DurationSeconds: aws.Int32(900),
	}
	if externalID != "" {
		assumeInput.ExternalId = aws.String(externalID)
	}

	assumed, err := stsClient.AssumeRole(ctx, assumeInput)
	if err != nil {
		return fmt.Errorf("failed to assume role %s: %w", roleARN, err)
	}

	assumedCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			*assumed.Credentials.AccessKeyId,
			*assumed.Credentials.SecretAccessKey,
			aws.ToString(assumed.Credentials.SessionToken),
		)),
	)
	if err != nil {
		return fmt.Errorf("failed to load EKS AWS config: %w", err)
	}

	eksClient := eks.NewFromConfig(assumedCfg)

	_, err = eksClient.UpdateAddon(ctx, &eks.UpdateAddonInput{
		AddonName:        aws.String(addonName),
		ClusterName:      aws.String(clusterName),
		AddonVersion:     aws.String(recommendedVersion),
		ResolveConflicts: "OVERWRITE",
	})
	if err != nil {
		return fmt.Errorf("failed to update EKS addon: %w", err)
	}

	return nil
}
