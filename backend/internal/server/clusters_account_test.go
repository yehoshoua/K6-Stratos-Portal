package server

import "testing"

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
