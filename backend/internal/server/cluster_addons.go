package server

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/eks"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"k6-bedrock-dashboard/backend/internal/discovery"
	"k6-bedrock-dashboard/backend/internal/k8s"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type ClusterAddonInfo struct {
	Name        string `json:"name"`
	Current     string `json:"current"`
	Recommended string `json:"recommended"`
	Status      string `json:"status"`
}

type addonAPI interface {
	DescribeCluster(context.Context, *eks.DescribeClusterInput, ...func(*eks.Options)) (*eks.DescribeClusterOutput, error)
	ListAddons(context.Context, *eks.ListAddonsInput, ...func(*eks.Options)) (*eks.ListAddonsOutput, error)
	DescribeAddon(context.Context, *eks.DescribeAddonInput, ...func(*eks.Options)) (*eks.DescribeAddonOutput, error)
	DescribeAddonVersions(context.Context, *eks.DescribeAddonVersionsInput, ...func(*eks.Options)) (*eks.DescribeAddonVersionsOutput, error)
}

// Use the same AWS identity as the registered context, not the portal's
// unrelated default profile. Never execute an additional credential command.
func (s *Server) addonClient(ctx context.Context, c *ClusterConfig) (*eks.Client, string, error) {
	name, region, profile, roleARN := c.Name, c.Region, "", ""
	var rc *rest.Config
	if c.AuthType == "local" || c.AuthType == "kubeconfig" || c.AuthType == "eks-assume-role" {
		secret, err := s.config.Decrypt(c.EncryptedData)
		if err != nil {
			return nil, "", fmt.Errorf("read cluster credentials: %w", err)
		}
		switch c.AuthType {
		case "local":
			rc, err = k8s.LocalRESTConfig(string(secret))
		case "kubeconfig":
			rc, err = clientcmd.RESTConfigFromKubeConfig(secret)
		case "eks-assume-role":
			roleARN = string(secret)
		}
		if err != nil {
			return nil, "", err
		}
	}
	if rc != nil && rc.ExecProvider != nil {
		exec := rc.ExecProvider
		if filepath.Base(exec.Command) != "aws" {
			return nil, "", fmt.Errorf("add-on checks require an AWS CLI kubeconfig identity")
		}
		for _, env := range exec.Env {
			if env.Name == "AWS_PROFILE" {
				profile = env.Value
			}
		}
		for i := 0; i < len(exec.Args); i++ {
			key, value, hasValue := strings.Cut(exec.Args[i], "=")
			if !hasValue && i+1 < len(exec.Args) {
				value = exec.Args[i+1]
			}
			switch key {
			case "--profile":
				profile = value
			case "--region":
				region = value
			case "--cluster-name":
				name = value
			case "--role-arn", "--role":
				roleARN = value
			}
		}
	}
	if region == "" {
		region = parseRegion(c.APIServerURL)
	}
	if region == "" {
		return nil, "", fmt.Errorf("cluster AWS region is missing")
	}
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if profile != "" {
		opts = append(opts, awsconfig.WithSharedConfigProfile(profile))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, "", err
	}
	if roleARN != "" {
		cfg.Credentials = aws.NewCredentialsCache(stscreds.NewAssumeRoleProvider(sts.NewFromConfig(cfg), roleARN, func(o *stscreds.AssumeRoleOptions) {
			if c.AuthType == "eks-assume-role" {
				o.ExternalID = aws.String(discovery.DiscoveryExternalID())
			}
		}))
	}
	return eks.NewFromConfig(cfg), name, nil
}

func (s *Server) handleGetClusterAddons(w http.ResponseWriter, r *http.Request) {
	c := s.storedCluster(r.PathValue("id"))
	if c == nil {
		s.writeError(w, http.StatusNotFound, "cluster not found")
		return
	}
	if c.AuthType == "mock" || strings.HasPrefix(c.APIServerURL, "mock") {
		writeJSON(w, []ClusterAddonInfo{})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	client, name, err := s.addonClient(ctx, c)
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "add-on check failed: "+err.Error())
		return
	}
	addons, err := inspectClusterAddons(ctx, client, name, c.APIServerURL)
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "add-on check failed: "+err.Error())
		return
	}
	writeJSON(w, addons)
}

func inspectClusterAddons(ctx context.Context, client addonAPI, name, endpoint string) ([]ClusterAddonInfo, error) {
	desc, err := client.DescribeCluster(ctx, &eks.DescribeClusterInput{Name: aws.String(name)})
	if err != nil {
		return nil, err
	}
	if desc.Cluster == nil || aws.ToString(desc.Cluster.Version) == "" || !strings.EqualFold(strings.TrimRight(aws.ToString(desc.Cluster.Endpoint), "/"), strings.TrimRight(endpoint, "/")) {
		return nil, fmt.Errorf("AWS cluster identity does not match the registered endpoint")
	}
	version := desc.Cluster.Version
	addons := []ClusterAddonInfo{}
	var next *string
	for {
		list, err := client.ListAddons(ctx, &eks.ListAddonsInput{ClusterName: aws.String(name), NextToken: next})
		if err != nil {
			return nil, err
		}
		for _, addonName := range list.Addons {
			installed, err := client.DescribeAddon(ctx, &eks.DescribeAddonInput{ClusterName: aws.String(name), AddonName: aws.String(addonName)})
			if err != nil {
				return nil, fmt.Errorf("%s: %w", addonName, err)
			}
			if installed.Addon == nil || aws.ToString(installed.Addon.AddonVersion) == "" {
				return nil, fmt.Errorf("%s: installed version unavailable", addonName)
			}
			latest := ""
			var versionsNext *string
			for {
				versions, err := client.DescribeAddonVersions(ctx, &eks.DescribeAddonVersionsInput{AddonName: aws.String(addonName), KubernetesVersion: version, NextToken: versionsNext})
				if err != nil {
					return nil, fmt.Errorf("%s: %w", addonName, err)
				}
				for _, info := range versions.Addons {
					if aws.ToString(info.AddonName) != addonName {
						continue
					}
					for _, v := range info.AddonVersions {
						compatible := false
						for _, compat := range v.Compatibilities {
							if aws.ToString(compat.ClusterVersion) != aws.ToString(version) {
								continue
							}
							for _, platform := range compat.PlatformVersions {
								if platform == "*" || platform == aws.ToString(desc.Cluster.PlatformVersion) {
									compatible = true
								}
							}
						}
						candidate := aws.ToString(v.AddonVersion)
						if compatible && candidate != "" && (latest == "" || isNewerOrEqual(candidate, latest)) {
							latest = candidate
						}
					}
				}
				versionsNext = versions.NextToken
				if aws.ToString(versionsNext) == "" {
					break
				}
			}
			if latest == "" {
				return nil, fmt.Errorf("%s: no compatible version found for Kubernetes %s", addonName, aws.ToString(version))
			}
			current := aws.ToString(installed.Addon.AddonVersion)
			if isNewerOrEqual(current, latest) {
				latest = current
			}
			addons = append(addons, ClusterAddonInfo{Name: addonName, Current: current, Recommended: latest, Status: string(installed.Addon.Status)})
		}
		next = list.NextToken
		if aws.ToString(next) == "" {
			break
		}
	}
	sort.Slice(addons, func(i, j int) bool { return addons[i].Name < addons[j].Name })
	return addons, nil
}
