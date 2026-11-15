package server

import (
	"k6-bedrock-dashboard/backend/internal/k8s"
	"testing"
)

func TestResolveAWSAccountIDFromARN(t *testing.T) {
	t.Parallel()

	got := resolveAWSAccountIDFromARN(
		"793123456789",
		"arn:aws:eks:us-east-1:107123456789:cluster/prod",
	)
	want := "107123456789"
	if got != want {
		t.Fatalf("resolveAWSAccountIDFromARN() = %q, want %q", got, want)
	}
}

func TestLocalContextAccountIDUsesRegisteredCluster(t *testing.T) {
	contexts := []k8s.LocalContextInfo{
		{ContextName: "current", ClusterName: "arn:aws:eks:us-east-1:720146705806:cluster/other", APIServerURL: "https://other.eks.amazonaws.com", IsCurrent: true},
		{ContextName: "demo-alias", ClusterName: "arn:aws:eks:us-east-1:107435627496:cluster/demo", APIServerURL: "https://demo.eks.amazonaws.com"},
	}
	if got := localContextAccountID("demo-alias", "https://demo.eks.amazonaws.com/", contexts); got != "107435627496" {
		t.Fatalf("account from registered alias = %q", got)
	}
	if got := localContextAccountID("demo-alias", "https://other.eks.amazonaws.com", contexts); got != "" {
		t.Fatalf("accepted mismatched endpoint: %q", got)
	}
	if got := localContextAccountID("missing", "https://demo.eks.amazonaws.com", contexts); got != "" {
		t.Fatalf("used unrelated context: %q", got)
	}
}
