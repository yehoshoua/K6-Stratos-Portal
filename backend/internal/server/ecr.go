package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ecr"
	ecrtypes "github.com/aws/aws-sdk-go-v2/service/ecr/types"
	"github.com/aws/aws-sdk-go-v2/service/eks"
	"github.com/aws/aws-sdk-go-v2/service/sts"

	"k6-bedrock-dashboard/backend/internal/discovery"
	"k6-bedrock-dashboard/backend/internal/k8s"
)

type ecrCheckResponse struct {
	Exists     bool   `json:"exists"`
	Repository string `json:"repository"`
	Registry   string `json:"registry"`
	Image      string `json:"image"`
	Message    string `json:"message,omitempty"`
}

func (s *Server) handleResolveClusterImage(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	if image == "" {
		http.Error(w, `{"error":"missing image query param"}`, http.StatusBadRequest)
		return
	}

	clusterConfig := s.getClusterConfig(clusterID)
	if clusterConfig == nil {
		http.Error(w, `{"error":"cluster not found"}`, http.StatusNotFound)
		return
	}

	writeJSON(w, map[string]string{
		"image": resolveClusterImage(image, clusterConfig),
	})
}

func (s *Server) handleCheckECRRepo(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	if image == "" {
		http.Error(w, `{"error":"missing image query param"}`, http.StatusBadRequest)
		return
	}

	clusterConfig := s.getClusterConfig(clusterID)
	if clusterConfig == nil || clusterConfig.AWSAccountID == "" || clusterConfig.Region == "" {
		http.Error(w, `{"error":"cluster aws account or region not configured"}`, http.StatusBadRequest)
		return
	}

	resolvedImage := resolveClusterImage(image, clusterConfig)
	repository := parseRepositoryFromImage(resolvedImage)
	if repository == "" {
		http.Error(w, `{"error":"unable to parse repository from image"}`, http.StatusBadRequest)
		return
	}

	domain := defaultEcrDomain(clusterConfig.Region)
	response := ecrCheckResponse{
		Exists:     false,
		Repository: repository,
		Registry:   fmt.Sprintf("%s.dkr.ecr.%s.%s", clusterConfig.AWSAccountID, clusterConfig.Region, domain),
		Image:      resolvedImage,
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(clusterConfig.Region))
	if err != nil {
		response.Message = fmt.Sprintf("failed to load AWS config: %v", err)
		writeJSON(w, response)
		return
	}

	client := ecr.NewFromConfig(cfg)
	_, err = client.DescribeRepositories(ctx, &ecr.DescribeRepositoriesInput{
		RepositoryNames: []string{repository},
	})
	if err != nil {
		var notFound *ecrtypes.RepositoryNotFoundException
		if errors.As(err, &notFound) {
			response.Message = "repository not found"
			writeJSON(w, response)
			return
		}
		response.Message = fmt.Sprintf("failed to query repository: %v", err)
		writeJSON(w, response)
		return
	}

	response.Exists = true
	writeJSON(w, response)
}

func parseRepositoryFromImage(image string) string {
	trimmed := strings.TrimSpace(strings.TrimPrefix(image, "/"))
	if trimmed == "" {
		return ""
	}

	parts := strings.Split(trimmed, "/")
	if len(parts) > 1 && (strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") || parts[0] == "localhost") {
		trimmed = strings.Join(parts[1:], "/")
	}

	trimmed = strings.SplitN(trimmed, "@", 2)[0]
	trimmed = strings.SplitN(trimmed, ":", 2)[0]
	return strings.Trim(trimmed, "/")
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func accountIDFromARN(arn string) string {
	return discovery.AccountIDFromARN(arn)
}

func resolveAWSAccountIDFromARN(explicitAccountID, clusterARN string) string {
	if parsed := accountIDFromARN(clusterARN); parsed != "" {
		return parsed
	}
	return strings.TrimSpace(explicitAccountID)
}

func (s *Server) awsAccountIDFromEKSCluster(ctx context.Context, c *ClusterConfig) string {
	if c == nil || strings.TrimSpace(c.Name) == "" {
		return ""
	}

	region := strings.TrimSpace(c.Region)
	if region == "" {
		region = parseRegion(c.APIServerURL)
	}
	if region == "" {
		return ""
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var awsCfg aws.Config
	var err error

	switch c.AuthType {
	case "local":
		client, name, err := s.addonClient(ctx, c)
		if err != nil {
			return ""
		}
		out, err := client.DescribeCluster(ctx, &eks.DescribeClusterInput{Name: aws.String(name)})
		if err != nil || out.Cluster == nil || !strings.EqualFold(strings.TrimRight(aws.ToString(out.Cluster.Endpoint), "/"), strings.TrimRight(c.APIServerURL, "/")) {
			return ""
		}
		return accountIDFromARN(aws.ToString(out.Cluster.Arn))
	case "eks-assume-role":
		if c.EncryptedData == "" {
			return ""
		}
		decrypted, err := s.config.Decrypt(c.EncryptedData)
		if err != nil {
			return ""
		}
		roleARN := strings.TrimSpace(string(decrypted))
		if roleARN == "" {
			return ""
		}

		baseCfg, err := awsconfig.LoadDefaultConfig(ctx)
		if err != nil {
			return ""
		}
		assumed, err := sts.NewFromConfig(baseCfg).AssumeRole(ctx, &sts.AssumeRoleInput{
			RoleArn:         aws.String(roleARN),
			RoleSessionName: aws.String("stratos-eks-account-resolve"),
			DurationSeconds: aws.Int32(900),
		})
		if err != nil {
			return ""
		}
		awsCfg, err = awsconfig.LoadDefaultConfig(ctx,
			awsconfig.WithRegion(region),
			awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				aws.ToString(assumed.Credentials.AccessKeyId),
				aws.ToString(assumed.Credentials.SecretAccessKey),
				aws.ToString(assumed.Credentials.SessionToken),
			)),
		)
		if err != nil {
			return ""
		}
	case "in-cluster":
		awsCfg, err = awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
		if err != nil {
			return ""
		}
	default:
		return ""
	}

	out, err := eks.NewFromConfig(awsCfg).DescribeCluster(ctx, &eks.DescribeClusterInput{
		Name: aws.String(c.Name),
	})
	if err != nil || out.Cluster == nil || out.Cluster.Arn == nil {
		return ""
	}
	return accountIDFromARN(aws.ToString(out.Cluster.Arn))
}

var (
	portalAWSAccountOnce sync.Once
	portalAWSAccountID   string
)

func (s *Server) portalAWSAccountID(ctx context.Context) string {
	portalAWSAccountOnce.Do(func() {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()

		cfg, err := awsconfig.LoadDefaultConfig(ctx)
		if err != nil {
			return
		}
		out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
		if err != nil {
			return
		}
		portalAWSAccountID = strings.TrimSpace(aws.ToString(out.Account))
	})
	return portalAWSAccountID
}

func (s *Server) awsAccountIDFromDiscoveryConfig(ctx context.Context, c *ClusterConfig) string {
	if c == nil {
		return ""
	}
	envVal := os.Getenv(discovery.EnvAccountsDiscovery)
	if envVal == "" {
		return ""
	}
	externalID := discovery.DiscoveryExternalID()
	configs, err := discovery.ParseAWSAccountsEnv(envVal)
	if err != nil || len(configs) == 0 {
		return ""
	}
	return discovery.LookupClusterAWSAccount(ctx, c.Name, c.APIServerURL, externalID, configs)
}

func (s *Server) enrichClusterMetadata(ctx context.Context, c *ClusterConfig, persist bool) {
	if c == nil {
		return
	}
	if c.Region == "" {
		c.Region = parseRegion(c.APIServerURL)
	}
	if c.AuthType == "local" {
		var inferredAccount string
		if contextName, err := s.config.Decrypt(c.EncryptedData); err == nil {
			if contexts, _, err := k8s.GetLocalContexts(); err == nil {
				inferredAccount = localContextAccountID(string(contextName), c.APIServerURL, contexts)
			}
		}
		if inferredAccount == "" && isAmazonEKSAPIEndpoint(c.APIServerURL) {
			inferredAccount = s.awsAccountIDFromEKSCluster(ctx, c)
		}
		if inferredAccount != "" && inferredAccount != c.AWSAccountID {
			c.AWSAccountID = inferredAccount
			if persist && s.db != nil {
				_ = s.db.SaveCluster(c)
			}
		}
		return
	}

	portalAccount := s.portalAWSAccountID(ctx)
	isEKSEndpoint := strings.Contains(c.APIServerURL, ".eks.amazonaws.com")

	var inferredAccount string
	if c.AuthType == "eks-assume-role" || c.AuthType == "in-cluster" {
		inferredAccount = s.awsAccountIDFromEKSCluster(ctx, c)
	}

	if inferredAccount == "" && isEKSEndpoint {
		inferredAccount = s.awsAccountIDFromDiscoveryConfig(ctx, c)
	}

	if inferredAccount == "" && c.AuthType == "eks-assume-role" && c.EncryptedData != "" {
		if decrypted, err := s.config.Decrypt(c.EncryptedData); err == nil {
			roleAccount := accountIDFromARN(string(decrypted))
			if roleAccount != "" && roleAccount != portalAccount {
				inferredAccount = roleAccount
			}
		}
	}

	if inferredAccount == "" || inferredAccount == c.AWSAccountID {
		return
	}

	c.AWSAccountID = inferredAccount
	if persist && s.db != nil {
		_ = s.db.SaveCluster(c)
	}
}

// Resolve the registered context, including aliases, without using the portal's
// default AWS identity or the kubeconfig's unrelated current context.
func localContextAccountID(contextName, endpoint string, contexts []k8s.LocalContextInfo) string {
	for _, c := range contexts {
		if c.ContextName != contextName || !strings.EqualFold(strings.TrimRight(c.APIServerURL, "/"), strings.TrimRight(endpoint, "/")) {
			continue
		}
		if account := accountIDFromARN(c.ClusterName); account != "" {
			return account
		}
		return accountIDFromARN(c.ContextName)
	}
	return ""
}
