package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"
)

func (s *Server) workspaceAuth(requiredRole string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username := r.Header.Get("X-User-Name")
		globalRole := r.Header.Get("X-User-Role")

		// Global admins bypass workspace restrictions
		if globalRole == "administrator" || globalRole == "admin" {
			next.ServeHTTP(w, r)
			return
		}

		workspaceID := r.Header.Get("X-Workspace-ID")
		if workspaceID == "" {
			workspaceID = r.URL.Query().Get("workspace_id")
		}
		if workspaceID == "" {
			workspaceID = "default"
		}

		role, err := s.db.GetWorkspaceUserRole(workspaceID, username)
		if err != nil {
			http.Error(w, `{"error":"failed to verify workspace role"}`, http.StatusInternalServerError)
			return
		}

		if role == "" {
			http.Error(w, `{"error":"access to workspace denied"}`, http.StatusForbidden)
			return
		}

		isAuthorized := false
		switch requiredRole {
		case "viewer":
			if role == "viewer" || role == "editor" || role == "administrator" {
				isAuthorized = true
			}
		case "editor":
			if role == "editor" || role == "administrator" {
				isAuthorized = true
			}
		case "administrator":
			if role == "administrator" {
				isAuthorized = true
			}
		}

		if !isAuthorized {
			http.Error(w, `{"error":"insufficient workspace permissions"}`, http.StatusForbidden)
			return
		}

		r.Header.Set("X-Workspace-ID", workspaceID)
		r.Header.Set("X-Workspace-Role", role)

		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	username := r.Header.Get("X-User-Name")
	role := r.Header.Get("X-User-Role")

	var list []*database.Workspace
	var err error

	if role == "administrator" || role == "admin" {
		list, err = s.db.GetWorkspaces()
	} else {
		list, err = s.db.GetWorkspacesForUser(username)
	}

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if input.ID == "" || input.Name == "" {
		http.Error(w, `{"error":"id and name are required"}`, http.StatusBadRequest)
		return
	}

	ws := &database.Workspace{
		ID:        input.ID,
		Name:      input.Name,
		CreatedAt: time.Now(),
	}

	if err := s.db.SaveWorkspace(ws); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(`{"status":"created"}`))
}

func (s *Server) handleCreateWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace id is required"}`, http.StatusBadRequest)
		return
	}

	username := r.Header.Get("X-User-Name")
	globalRole := r.Header.Get("X-User-Role")

	if globalRole != "administrator" && globalRole != "admin" {
		role, err := s.db.GetWorkspaceUserRole(workspaceID, username)
		if err != nil || role != "administrator" {
			http.Error(w, `{"error":"only workspace administrators can add members"}`, http.StatusForbidden)
			return
		}
	}

	var input struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if input.Username == "" || input.Role == "" {
		http.Error(w, `{"error":"username and role are required"}`, http.StatusBadRequest)
		return
	}

	if input.Role != "viewer" && input.Role != "editor" && input.Role != "administrator" {
		http.Error(w, `{"error":"invalid role, must be viewer, editor, or administrator"}`, http.StatusBadRequest)
		return
	}

	wu := &database.WorkspaceUser{
		WorkspaceID: workspaceID,
		Username:    input.Username,
		Role:        input.Role,
	}

	if err := s.db.SaveWorkspaceUser(wu); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"added"}`))
}

func (s *Server) handleUpdateWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	username := r.PathValue("username")
	if workspaceID == "" || username == "" {
		http.Error(w, `{"error":"workspace id and username are required"}`, http.StatusBadRequest)
		return
	}

	requester := r.Header.Get("X-User-Name")
	globalRole := r.Header.Get("X-User-Role")
	if globalRole != "administrator" && globalRole != "admin" {
		role, err := s.db.GetWorkspaceUserRole(workspaceID, requester)
		if err != nil || role != "administrator" {
			http.Error(w, `{"error":"only workspace administrators can update members"}`, http.StatusForbidden)
			return
		}
	}

	var input struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if input.Role != "viewer" && input.Role != "editor" && input.Role != "administrator" {
		http.Error(w, `{"error":"invalid role, must be viewer, editor, or administrator"}`, http.StatusBadRequest)
		return
	}

	existing, err := s.db.GetWorkspaceUserMembership(workspaceID, username)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	if existing == nil {
		http.Error(w, `{"error":"workspace member not found"}`, http.StatusNotFound)
		return
	}

	source := existing.Source
	if source == "" {
		source = "manual"
	}
	if err := s.db.SaveWorkspaceUserWithSource(&database.WorkspaceUser{
		WorkspaceID: workspaceID,
		Username:    username,
		Role:        input.Role,
	}, source); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"updated"}`))
}

func (s *Server) handleDeleteWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	username := r.PathValue("username")
	if workspaceID == "" || username == "" {
		http.Error(w, `{"error":"workspace id and username are required"}`, http.StatusBadRequest)
		return
	}

	requester := r.Header.Get("X-User-Name")
	globalRole := r.Header.Get("X-User-Role")
	if globalRole != "administrator" && globalRole != "admin" {
		role, err := s.db.GetWorkspaceUserRole(workspaceID, requester)
		if err != nil || role != "administrator" {
			http.Error(w, `{"error":"only workspace administrators can remove members"}`, http.StatusForbidden)
			return
		}
	}

	if err := s.db.DeleteWorkspaceUser(workspaceID, username); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"removed"}`))
}

func (s *Server) handleListWorkspaceGroupMappings(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace id is required"}`, http.StatusBadRequest)
		return
	}

	list, err := s.db.GetWorkspaceGroupMappings(workspaceID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateWorkspaceGroupMapping(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace id is required"}`, http.StatusBadRequest)
		return
	}

	var input struct {
		IDPGroup string `json:"idp_group"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if input.IDPGroup == "" || input.Role == "" {
		http.Error(w, `{"error":"idp_group and role are required"}`, http.StatusBadRequest)
		return
	}
	if input.Role != "viewer" && input.Role != "editor" && input.Role != "administrator" {
		http.Error(w, `{"error":"invalid role, must be viewer, editor, or administrator"}`, http.StatusBadRequest)
		return
	}

	mapping := &database.WorkspaceGroupMapping{
		WorkspaceID: workspaceID,
		IDPGroup:    input.IDPGroup,
		Role:        input.Role,
	}
	if err := s.db.SaveWorkspaceGroupMapping(mapping); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(`{"status":"created"}`))
}

func (s *Server) handleDeleteWorkspaceGroupMapping(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	idpGroup := r.PathValue("group")
	if workspaceID == "" || idpGroup == "" {
		http.Error(w, `{"error":"workspace id and group are required"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteWorkspaceGroupMapping(workspaceID, idpGroup); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"deleted"}`))
}

func (s *Server) handleGetUserWorkspaces(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if username == "" {
		http.Error(w, `{"error":"username is required"}`, http.StatusBadRequest)
		return
	}

	requester := r.Header.Get("X-User-Name")
	globalRole := r.Header.Get("X-User-Role")
	if requester != username && globalRole != "administrator" && globalRole != "admin" {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	list, err := s.db.GetWorkspaceMembershipsForUser(username)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleListWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace id is required"}`, http.StatusBadRequest)
		return
	}

	list, err := s.db.GetWorkspaceUsers(workspaceID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace id is required"}`, http.StatusBadRequest)
		return
	}

	if workspaceID == "default" {
		http.Error(w, `{"error":"cannot delete the default workspace"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteWorkspace(workspaceID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"deleted"}`))
}
