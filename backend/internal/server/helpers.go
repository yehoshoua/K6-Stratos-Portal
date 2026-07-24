package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"k6-bedrock-dashboard/backend/internal/database"
)

// Workspace role constants (aligned with database layer)
const (
	RoleViewer       = database.WorkspaceRoleViewer
	RoleEditor       = database.WorkspaceRoleEditor
	RoleAdministrator = database.WorkspaceRoleAdministrator
)

// Error response helper
func (s *Server) writeError(w http.ResponseWriter, statusCode int, errMsg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": errMsg})
}

// Success response helper
func (s *Server) writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

// Validation helper for workspace roles
func isValidRole(role string) bool {
	role = strings.TrimSpace(role)
	return role == RoleViewer || role == RoleEditor || role == RoleAdministrator
}

// Authorization helper: check if requester has workspace admin role
// Returns nil if authorized, error if not
func (s *Server) requireWorkspaceAdmin(workspaceID, requesterName, globalRole string) error {
	// Global admins have access to all workspaces
	if globalRole == "administrator" || globalRole == "admin" {
		return nil
	}

	// Check workspace-specific role
	role, err := s.db.GetWorkspaceUserRole(workspaceID, requesterName)
	if err != nil {
		return fmt.Errorf("failed to verify workspace role: %w", err)
	}

	if role != RoleAdministrator {
		return fmt.Errorf("insufficient workspace permissions")
	}

	return nil
}

// Helper to extract and validate path parameters
func getPathParams(r *http.Request, keys ...string) (map[string]string, error) {
	params := make(map[string]string)
	for _, key := range keys {
		value := r.PathValue(key)
		if value == "" {
			return nil, fmt.Errorf("%s is required", key)
		}
		params[key] = value
	}
	return params, nil
}

// Helper to extract user info from request headers
type UserInfo struct {
	Username   string
	GlobalRole string
	WorkspaceID string
}

func getUserInfo(r *http.Request) UserInfo {
	return UserInfo{
		Username:    r.Header.Get("X-User-Name"),
		GlobalRole:  r.Header.Get("X-User-Role"),
		WorkspaceID: r.Header.Get("X-Workspace-ID"),
	}
}
