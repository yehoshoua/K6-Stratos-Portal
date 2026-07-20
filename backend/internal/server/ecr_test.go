package server

import "testing"

func TestAccountIDFromARN(t *testing.T) {
	t.Parallel()

	tests := []struct {
		arn  string
		want string
	}{
		{
			arn:  "arn:aws:iam::107123456789:role/eks-discovery",
			want: "107123456789",
		},
		{
			arn:  "arn:aws:eks:us-east-1:107123456789:cluster/my-cluster",
			want: "107123456789",
		},
		{arn: "not-an-arn", want: ""},
		{arn: "arn:aws:iam::793123456789:role/other", want: "793123456789"},
	}

	for _, tc := range tests {
		if got := accountIDFromARN(tc.arn); got != tc.want {
			t.Fatalf("accountIDFromARN(%q) = %q, want %q", tc.arn, got, tc.want)
		}
	}
}

func TestResolveClusterImageReplacesForeignECRAccount(t *testing.T) {
	t.Parallel()

	cluster := &ClusterConfig{
		AWSAccountID: "107123456789",
		Region:       "eu-west-1",
	}

	got := resolveClusterImage(
		"793123456789.dkr.ecr.eu-west-1.amazonaws.com/rem-helm-images/rem-apps/xk6:latest",
		cluster,
	)
	want := "107123456789.dkr.ecr.eu-west-1.amazonaws.com/rem-helm-images/rem-apps/xk6:latest"
	if got != want {
		t.Fatalf("resolveClusterImage() = %q, want %q", got, want)
	}
}
