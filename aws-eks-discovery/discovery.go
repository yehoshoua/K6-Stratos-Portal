package discovery

import (
	"context"
	"fmt"
	"log"
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
	Name         string
	APIServerURL string
	CACertBase64 string
	AWSAccountID string
	Region       string
	RoleARN      string
}

// AWSAccountConfig holds the parsed configuration for a target AWS account and its regions
type AWSAccountConfig struct {
	AccountID string
	Regions   []string
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
		roleARN := fmt.Sprintf("arn:aws:iam::%s:role/StratosEKSDiscoveryRole", acc.AccountID)

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

					mu.Lock()
					discovered = append(discovered, DiscoveredCluster{
						Name:         name,
						APIServerURL: aws.ToString(cluster.Endpoint),
						CACertBase64: aws.ToString(cluster.CertificateAuthority.Data),
						AWSAccountID: accountID,
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
