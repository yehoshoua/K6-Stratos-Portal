package discovery

import "testing"

func TestDiscoveryRoleNameUsesEnvOverride(t *testing.T) {
	t.Setenv(EnvAccountsDiscoveryRole, "CustomDiscoveryRole")
	if got := DiscoveryRoleName(); got != "CustomDiscoveryRole" {
		t.Fatalf("DiscoveryRoleName() = %q, want CustomDiscoveryRole", got)
	}
	if got := DiscoveryRoleARN("123456789012"); got != "arn:aws:iam::123456789012:role/CustomDiscoveryRole" {
		t.Fatalf("DiscoveryRoleARN() = %q", got)
	}
}

func TestDiscoveryRoleNameDefault(t *testing.T) {
	t.Setenv(EnvAccountsDiscoveryRole, "")
	if got := DiscoveryRoleName(); got != DefaultDiscoveryRoleName {
		t.Fatalf("DiscoveryRoleName() = %q, want default", got)
	}
}

func TestAccountIDFromARN(t *testing.T) {
	t.Parallel()

	tests := []struct {
		arn  string
		want string
	}{
		{
			arn:  "arn:aws:eks:us-east-1:107123456789:cluster/my-cluster",
			want: "107123456789",
		},
		{
			arn:  "arn:aws:iam::793123456789:role/StratosEKSDiscoveryRole",
			want: "793123456789",
		},
		{arn: "not-an-arn", want: ""},
	}

	for _, tc := range tests {
		if got := AccountIDFromARN(tc.arn); got != tc.want {
			t.Fatalf("AccountIDFromARN(%q) = %q, want %q", tc.arn, got, tc.want)
		}
	}
}
