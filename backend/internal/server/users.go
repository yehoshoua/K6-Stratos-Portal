package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"k6-bedrock-dashboard/backend/internal/auth"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/guardian"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	list, err := s.db.GetUsers()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get users: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		Role            string `json:"role"`
		ValidationRunID string `json:"validation_run_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Username == "" || body.Password == "" || body.Role == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	requestedBy := r.Header.Get("X-User-Name")
	rbacSubject := guardian.Subject{
		Type:        guardian.SubjectRBACChange,
		Ref:         body.Username,
		RequestedBy: requestedBy,
		Payload: map[string]interface{}{
			"role":            body.Role,
			"target_username": body.Username,
		},
	}
	if err := s.guardianGate(r.Context(), r, rbacSubject, body.ValidationRunID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusPreconditionFailed)
		return
	}

	// bcrypt embeds its own salt in the hash, so no separate salt needs
	// to be generated or stored for new/updated users (see auth.HashPassword).
	passwordHash, err := auth.HashPassword(body.Password)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to hash password: %v"}`, err), http.StatusInternalServerError)
		return
	}

	newUser := &database.User{
		Username:     body.Username,
		PasswordHash: passwordHash,
		Salt:         "",
		Role:         body.Role,
		CreatedAt:    time.Now(),
	}

	if err := s.db.SaveUser(newUser); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save user: %v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("user.create_or_update", requestedBy, body.Username, map[string]interface{}{"role": body.Role})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newUser)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	username := r.PathValue("username")
	if username == "" {
		http.Error(w, `{"error":"missing username"}`, http.StatusBadRequest)
		return
	}

	if username == "admin" {
		http.Error(w, `{"error":"cannot delete main administrator account"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteUser(username); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete user: %v"}`, err), http.StatusInternalServerError)
		return
	}
	_ = s.db.DeleteUserScopesForUser(username)
	s.audit("user.delete", r.Header.Get("X-User-Name"), username, nil)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}
