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

		workspaceID := r.Header.Get("X-Workspace-ID")
		if workspaceID == "" {
			workspaceID = r.URL.Query().Get("workspace_id")
		}
		if workspaceID == "" {
			workspaceID = "default"
		}
		if !workspaceIDPattern.MatchString(workspaceID) {
			s.writeError(w, 400, "invalid workspace id")
			return
		}
		r.Header.Set("X-Workspace-ID", workspaceID)
		if globalRole == "administrator" || globalRole == "admin" {
			next.ServeHTTP(w, r)
			return
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

	if !workspaceIDPattern.MatchString(input.ID) || input.Name == "" {
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
		s.writeError(w, http.StatusBadRequest, "workspace id is required")
		return
	}

	requester := getUserInfo(r)
	if err := s.requireWorkspaceAdmin(workspaceID, requester.Username, requester.GlobalRole); err != nil {
		s.writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var input struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Username == "" {
		s.writeError(w, http.StatusBadRequest, "username is required")
		return
	}

	if !isValidRole(input.Role) {
		s.writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid role, must be %s, %s, or %s", RoleViewer, RoleEditor, RoleAdministrator))
		return
	}

	wu := &database.WorkspaceUser{
		WorkspaceID: workspaceID,
		Username:    input.Username,
		Role:        input.Role,
	}

	if err := s.db.SaveWorkspaceUser(wu); err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to add workspace member: %v", err))
		return
	}

	s.writeJSON(w, http.StatusCreated, map[string]string{"status": "added"})
}

func (s *Server) handleUpdateWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	username := r.PathValue("username")
	if workspaceID == "" || username == "" {
		s.writeError(w, http.StatusBadRequest, "workspace id and username are required")
		return
	}

	requester := getUserInfo(r)
	if err := s.requireWorkspaceAdmin(workspaceID, requester.Username, requester.GlobalRole); err != nil {
		s.writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var input struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !isValidRole(input.Role) {
		s.writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid role, must be %s, %s, or %s", RoleViewer, RoleEditor, RoleAdministrator))
		return
	}

	existing, err := s.db.GetWorkspaceUserMembership(workspaceID, username)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to fetch member: %v", err))
		return
	}
	if existing == nil {
		s.writeError(w, http.StatusNotFound, "workspace member not found")
		return
	}

	source := existing.Source
	if source == "" {
		source = database.MembershipSourceManual
	}
	if err := s.db.SaveWorkspaceUserWithSource(&database.WorkspaceUser{
		WorkspaceID: workspaceID,
		Username:    username,
		Role:        input.Role,
	}, source); err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update member: %v", err))
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleDeleteWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	username := r.PathValue("username")
	if workspaceID == "" || username == "" {
		s.writeError(w, http.StatusBadRequest, "workspace id and username are required")
		return
	}

	requester := getUserInfo(r)
	if err := s.requireWorkspaceAdmin(workspaceID, requester.Username, requester.GlobalRole); err != nil {
		s.writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := s.db.DeleteWorkspaceUser(workspaceID, username); err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to remove member: %v", err))
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
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
		s.writeError(w, http.StatusBadRequest, "workspace id is required")
		return
	}

	var input struct {
		IDPGroup string `json:"idp_group"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.IDPGroup == "" {
		s.writeError(w, http.StatusBadRequest, "idp_group is required")
		return
	}

	if !isValidRole(input.Role) {
		s.writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid role, must be %s, %s, or %s", RoleViewer, RoleEditor, RoleAdministrator))
		return
	}

	mapping := &database.WorkspaceGroupMapping{
		WorkspaceID: workspaceID,
		IDPGroup:    input.IDPGroup,
		Role:        input.Role,
	}
	if err := s.db.SaveWorkspaceGroupMapping(mapping); err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create mapping: %v", err))
		return
	}

	s.writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (s *Server) handleDeleteWorkspaceGroupMapping(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	idpGroup := r.PathValue("group")
	if workspaceID == "" || idpGroup == "" {
		s.writeError(w, http.StatusBadRequest, "workspace id and group are required")
		return
	}

	if err := s.db.DeleteWorkspaceGroupMapping(workspaceID, idpGroup); err != nil {
		s.writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete mapping: %v", err))
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
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
