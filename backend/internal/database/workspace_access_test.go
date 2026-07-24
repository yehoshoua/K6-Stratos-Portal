package database

import (
	"testing"
)

func TestIsValidWorkspaceRole(t *testing.T) {
	tests := []struct {
		name     string
		role     string
		expected bool
	}{
		{"viewer", WorkspaceRoleViewer, true},
		{"editor", WorkspaceRoleEditor, true},
		{"administrator", WorkspaceRoleAdministrator, true},
		{"invalid", "invalid", false},
		{"empty", "", false},
		{"whitespace", "   ", false},
		{"with whitespace viewer", "  viewer  ", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidWorkspaceRole(tt.role); got != tt.expected {
				t.Errorf("isValidWorkspaceRole(%q) = %v, want %v", tt.role, got, tt.expected)
			}
		})
	}
}

func TestWorkspaceRoleRank(t *testing.T) {
	tests := []struct {
		name     string
		role     string
		expected int
	}{
		{"viewer", WorkspaceRoleViewer, 1},
		{"editor", WorkspaceRoleEditor, 2},
		{"administrator", WorkspaceRoleAdministrator, 3},
		{"admin short", "admin", 3},
		{"edit short", "edit", 2},
		{"view short", "view", 1},
		{"invalid", "invalid", 0},
		{"empty", "", 0},
		{"with case", "VIEWER", 1},
		{"with whitespace", "  editor  ", 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := workspaceRoleRank(tt.role); got != tt.expected {
				t.Errorf("workspaceRoleRank(%q) = %d, want %d", tt.role, got, tt.expected)
			}
		})
	}
}

func TestHigherWorkspaceRole(t *testing.T) {
	tests := []struct {
		name      string
		current   string
		candidate string
		expected  string
	}{
		{"both viewer", WorkspaceRoleViewer, WorkspaceRoleViewer, WorkspaceRoleViewer},
		{"current viewer, candidate editor", WorkspaceRoleViewer, WorkspaceRoleEditor, WorkspaceRoleEditor},
		{"current editor, candidate viewer", WorkspaceRoleEditor, WorkspaceRoleViewer, WorkspaceRoleEditor},
		{"current editor, candidate admin", WorkspaceRoleEditor, WorkspaceRoleAdministrator, WorkspaceRoleAdministrator},
		{"empty current", "", WorkspaceRoleEditor, WorkspaceRoleEditor},
		{"empty candidate", WorkspaceRoleEditor, "", WorkspaceRoleEditor},
		{"both empty", "", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := higherWorkspaceRole(tt.current, tt.candidate); got != tt.expected {
				t.Errorf("higherWorkspaceRole(%q, %q) = %q, want %q", tt.current, tt.candidate, got, tt.expected)
			}
		})
	}
}

func TestNormalizeIDPGroup(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"lowercase", "admins", "admins"},
		{"uppercase", "ADMINS", "admins"},
		{"mixed case", "AdminGroup", "admingroup"},
		{"with spaces", "  admin group  ", "admin group"},
		{"empty", "", ""},
		{"only spaces", "   ", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeIDPGroup(tt.input); got != tt.expected {
				t.Errorf("normalizeIDPGroup(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
