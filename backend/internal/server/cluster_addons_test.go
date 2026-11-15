package server

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eks"
	"github.com/aws/aws-sdk-go-v2/service/eks/types"
)

const addonTestEndpoint = "https://test.eks.amazonaws.com"

type fakeAddonAPI struct {
	fail   string
	empty  bool
	status types.AddonStatus
}

func (f *fakeAddonAPI) DescribeCluster(context.Context, *eks.DescribeClusterInput, ...func(*eks.Options)) (*eks.DescribeClusterOutput, error) {
	return &eks.DescribeClusterOutput{Cluster: &types.Cluster{Endpoint: aws.String(addonTestEndpoint), Version: aws.String("1.37"), PlatformVersion: aws.String("eks.8")}}, nil
}
func (f *fakeAddonAPI) ListAddons(_ context.Context, in *eks.ListAddonsInput, _ ...func(*eks.Options)) (*eks.ListAddonsOutput, error) {
	if f.fail == "list" {
		return nil, errors.New("access denied")
	}
	if f.empty {
		return &eks.ListAddonsOutput{}, nil
	}
	if in.NextToken == nil {
		return &eks.ListAddonsOutput{Addons: []string{"vpc-cni"}, NextToken: aws.String("page2")}, nil
	}
	return &eks.ListAddonsOutput{Addons: []string{"coredns"}}, nil
}
func (f *fakeAddonAPI) DescribeAddon(_ context.Context, in *eks.DescribeAddonInput, _ ...func(*eks.Options)) (*eks.DescribeAddonOutput, error) {
	if f.fail == "installed" {
		return nil, errors.New("access denied")
	}
	status := f.status
	if status == "" {
		status = types.AddonStatusActive
	}
	version := "v1.23.2-eksbuild.12"
	if aws.ToString(in.AddonName) == "coredns" {
		version = "v1.23.3-eksbuild.12"
	}
	return &eks.DescribeAddonOutput{Addon: &types.Addon{AddonVersion: aws.String(version), Status: status}}, nil
}
func (f *fakeAddonAPI) DescribeAddonVersions(_ context.Context, in *eks.DescribeAddonVersionsInput, _ ...func(*eks.Options)) (*eks.DescribeAddonVersionsOutput, error) {
	if f.fail == "versions" {
		return nil, errors.New("catalog unavailable")
	}
	if aws.ToString(in.KubernetesVersion) != "1.37" {
		return nil, errors.New("wrong Kubernetes version")
	}
	versions := []types.AddonVersionInfo{}
	if f.fail != "no-compatible" {
		version := "v1.23.3-eksbuild.2"
		if in.NextToken != nil {
			version = "v1.23.3-eksbuild.12"
		}
		versions = append(versions, types.AddonVersionInfo{AddonVersion: aws.String(version), Compatibilities: []types.Compatibility{{ClusterVersion: aws.String("1.37"), PlatformVersions: []string{"*"}}}})
	}
	// A newer version for another platform must not be recommended.
	versions = append(versions, types.AddonVersionInfo{AddonVersion: aws.String("v9.0.0-eksbuild.1"), Compatibilities: []types.Compatibility{{ClusterVersion: aws.String("1.37"), PlatformVersions: []string{"eks.99"}}}})
	out := &eks.DescribeAddonVersionsOutput{Addons: []types.AddonInfo{{AddonName: in.AddonName, AddonVersions: versions}}}
	if in.NextToken == nil {
		out.NextToken = aws.String("versions2")
	}
	return out, nil
}

func TestInspectClusterAddonsUsesLivePaginatedCatalog(t *testing.T) {
	addons, err := inspectClusterAddons(context.Background(), &fakeAddonAPI{}, "test", addonTestEndpoint)
	if err != nil {
		t.Fatal(err)
	}
	if len(addons) != 2 || addons[0].Name != "coredns" || addons[1].Name != "vpc-cni" {
		t.Fatalf("missing installed add-ons: %+v", addons)
	}
	if addons[1].Current != "v1.23.2-eksbuild.12" || addons[1].Recommended != "v1.23.3-eksbuild.12" {
		t.Fatalf("incorrect update: %+v", addons[1])
	}
	if addons[0].Current != addons[0].Recommended {
		t.Fatalf("up-to-date addon: %+v", addons[0])
	}
}
func TestInspectClusterAddonsFailsClosed(t *testing.T) {
	for _, failure := range []string{"list", "installed", "versions", "no-compatible"} {
		t.Run(failure, func(t *testing.T) {
			addons, err := inspectClusterAddons(context.Background(), &fakeAddonAPI{fail: failure}, "test", addonTestEndpoint)
			if err == nil || addons != nil {
				t.Fatalf("failure presented as success: %+v %v", addons, err)
			}
		})
	}
	if _, err := inspectClusterAddons(context.Background(), &fakeAddonAPI{}, "test", "https://other.eks.amazonaws.com"); err == nil {
		t.Fatal("wrong AWS cluster accepted")
	}
}
func TestInspectClusterAddonsEmptyAndDegraded(t *testing.T) {
	addons, err := inspectClusterAddons(context.Background(), &fakeAddonAPI{empty: true}, "test", addonTestEndpoint)
	if err != nil || addons == nil || len(addons) != 0 {
		t.Fatalf("empty result: %+v %v", addons, err)
	}
	addons, err = inspectClusterAddons(context.Background(), &fakeAddonAPI{status: types.AddonStatusDegraded}, "test", addonTestEndpoint)
	if err != nil || addons[0].Status != "DEGRADED" {
		t.Fatalf("health lost: %+v %v", addons, err)
	}
}
