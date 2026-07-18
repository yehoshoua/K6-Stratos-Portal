package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/guardian"
)

func (s *Server) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	tokens, err := s.db.ListAPITokens()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list API tokens: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokens)
}

func (s *Server) handleGenerateAPIToken(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Name            string   `json:"name"`
		Role            string   `json:"role"`
		Scopes          []string `json:"scopes"`
		ExpiryDays      int      `json:"expiry_days"` // 0 means Never, otherwise positive days
		ValidationRunID string   `json:"validation_run_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" {
		http.Error(w, `{"error":"name is required"}`, http.StatusBadRequest)
		return
	}
	if body.Role != "administrator" && body.Role != "admin" && body.Role != "editor" && body.Role != "edit" && body.Role != "viewer" && body.Role != RoleSecurityAuditor {
		http.Error(w, `{"error":"invalid role"}`, http.StatusBadRequest)
		return
	}

	// Default scopes if not provided
	var scopesStr string
	if len(body.Scopes) > 0 {
		allowed := validScopesForRole(body.Role)
		unique := make(map[string]bool, len(body.Scopes))
		for _, scope := range body.Scopes {
			scope = strings.TrimSpace(scope)
			if !allowed[scope] {
				http.Error(w, `{"error":"scope is not permitted for the selected role"}`, http.StatusBadRequest)
				return
			}
			unique[scope] = true
		}
		validatedScopes := make([]string, 0, len(unique))
		for _, scope := range body.Scopes {
			scope = strings.TrimSpace(scope)
			if unique[scope] {
				validatedScopes = append(validatedScopes, scope)
				delete(unique, scope)
			}
		}
		scopesStr = strings.Join(validatedScopes, ",")
	} else {
		scopesStr = scopesForRole(body.Role)
	}

	requestedBy := r.Header.Get("X-User-Name")
	tokenSubject := guardian.Subject{
		Type:        guardian.SubjectTokenGrant,
		Ref:         body.Name,
		RequestedBy: requestedBy,
		Payload: map[string]interface{}{
			"name":   body.Name,
			"role":   body.Role,
			"scopes": scopesStr,
		},
	}
	if err := s.guardianGate(r.Context(), r, tokenSubject, body.ValidationRunID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusPreconditionFailed)
		return
	}

	// Generate raw token starting with stratum_tok_
	randomBytes := make([]byte, 24)
	if _, err := rand.Read(randomBytes); err != nil {
		http.Error(w, `{"error":"failed to generate random bytes"}`, http.StatusInternalServerError)
		return
	}
	rawToken := "stratum_tok_" + hex.EncodeToString(randomBytes)

	// Hash the token using SHA-256 for storage
	hasher := sha256.New()
	hasher.Write([]byte(rawToken))
	tokenHash := hex.EncodeToString(hasher.Sum(nil))

	var expiresAt *time.Time
	if body.ExpiryDays > 0 {
		exp := time.Now().AddDate(0, 0, body.ExpiryDays)
		expiresAt = &exp
	}

	if err := s.db.SaveAPIToken(tokenHash, body.Name, body.Role, scopesStr, expiresAt); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save API token: %v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("token.create", requestedBy, body.Name, map[string]interface{}{"role": body.Role, "scopes": scopesStr})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":      rawToken,
		"token_hash": tokenHash,
		"name":       body.Name,
		"role":       body.Role,
		"scopes":     body.Scopes,
		"expires_at": expiresAt,
	})
}

func (s *Server) handleDeleteAPIToken(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	hash := r.PathValue("hash")
	if hash == "" {
		http.Error(w, `{"error":"missing token hash"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteAPIToken(hash); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete API token: %v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("token.revoke", r.Header.Get("X-User-Name"), hash, nil)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}
