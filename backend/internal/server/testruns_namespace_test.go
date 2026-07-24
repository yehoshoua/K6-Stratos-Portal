package server

import "testing"

func TestIsAmazonEKSAPIEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		want     bool
	}{
		{name: "IPv4 EKS", endpoint: "https://ABC.gr7.eu-west-1.eks.amazonaws.com", want: true},
		{name: "dual stack EKS", endpoint: "https://ABC.eu-west-1.api.aws", want: true},
		{name: "China EKS", endpoint: "https://ABC.cn-north-1.amazonwebservices.com.cn", want: true},
		{name: "generic Kubernetes", endpoint: "https://kubernetes.example.com", want: false},
		{name: "mock", endpoint: "mock", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAmazonEKSAPIEndpoint(tt.endpoint); got != tt.want {
				t.Fatalf("isAmazonEKSAPIEndpoint(%q) = %v, want %v", tt.endpoint, got, tt.want)
			}
		})
	}
}

func TestNamespaceLabelSelector(t *testing.T) {
	eks := &ClusterConfig{APIServerURL: "https://ABC.us-east-1.eks.amazonaws.com"}
	if got := namespaceLabelSelector(eks); got != "k6s" {
		t.Fatalf("EKS selector = %q, want k6s", got)
	}

	generic := &ClusterConfig{APIServerURL: "https://kubernetes.example.com"}
	if got := namespaceLabelSelector(generic); got != "k6s" {
		t.Fatalf("generic selector = %q, want k6s", got)
	}
}

func TestIsNewerOrEqual(t *testing.T) {
	tests := []struct {
		current     string
		recommended string
		want        bool
	}{
		{current: "v1.18.5", recommended: "v1.18.1", want: true},
		{current: "v1.18.1", recommended: "v1.18.5", want: false},
		{current: "v1.18.1", recommended: "v1.18.1", want: true},
		{current: "v1.18.1-eksbuild.3", recommended: "v1.18.1-eksbuild.1", want: true},
		{current: "v1.18.1-eksbuild.1", recommended: "v1.18.1-eksbuild.3", want: false},
		{current: "v1.18.1", recommended: "v1.18.1-eksbuild.1", want: false},
		{current: "v1.18.1-eksbuild.1", recommended: "v1.18.1", want: true},
		{current: "v1.19.0", recommended: "v1.18.5-eksbuild.12", want: true},
		{current: "unknown", recommended: "v1.18.1", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.current+"_vs_"+tt.recommended, func(t *testing.T) {
			if got := isNewerOrEqual(tt.current, tt.recommended); got != tt.want {
				t.Fatalf("isNewerOrEqual(%q, %q) = %v, want %v", tt.current, tt.recommended, got, tt.want)
			}
		})
	}
}
