package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"
)

var validEnvironments = map[string]bool{"dev": true, "stage": true, "prod": true, "sandbox": true}

// normalizeEnvironment validates an explicit environment value, falling
// back to a best-effort inference from the cluster name (e.g.
// "eks-prod-uswest2-01" -> "prod") when nothing explicit was set. Guardian
// production-safety checks and the Fleet Dashboard both depend on this;
// admins should still set it explicitly in Settings for accuracy.
func normalizeEnvironment(explicit, clusterName string) string {
	e := strings.ToLower(strings.TrimSpace(explicit))
	if validEnvironments[e] {
		return e
	}
	lowerName := strings.ToLower(clusterName)
	for _, env := range []string{"prod", "stage", "sandbox", "dev"} {
		if strings.Contains(lowerName, env) {
			return env
		}
	}
	return ""
}

// RoleSecurityAuditor is a read-only compliance role added alongside
// Guardian: full visibility into audit logs, SSO settings, and Guardian
// validation history, but no write access anywhere (see the RBAC matrix
// in docs/architecture_design.md section E).
const RoleSecurityAuditor = "security_auditor"

// scopesForRole maps a platform role to its default virtual scope set.
// Centralized here (instead of duplicated per auth path) so adding
// security_auditor only requires one change.
func scopesForRole(role string) string {
	switch role {
	case "administrator", "admin":
		return "admin:full"
	case "editor", "edit":
		return "tests:read,tests:create,tests:update,tests:launch,schedules:create,logs:read,metrics:read,clusters:read"
	case RoleSecurityAuditor:
		return "audit:read,tests:read,clusters:read,logs:read,metrics:read"
	default:
		return "tests:read,clusters:read,logs:read,metrics:read"
	}
}

// hasScope compares discrete, comma-separated scopes. Substring matching is
// unsafe: for example, "not-admin:full" must never satisfy "admin:full".
func hasScope(scopes, wanted string) bool {
	for _, scope := range strings.Split(scopes, ",") {
		if strings.TrimSpace(scope) == wanted {
			return true
		}
	}
	return false
}

func validScopesForRole(role string) map[string]bool {
	allowed := make(map[string]bool)
	for _, scope := range strings.Split(scopesForRole(role), ",") {
		allowed[strings.TrimSpace(scope)] = true
	}
	return allowed
}

// --- User scopes (ABAC) ---
//
// A scope row narrows a user's role to a specific AWS account, cluster,
// namespace, and/or environment. A user with zero scope rows is treated
// as unrestricted within their role (this keeps every existing
// single-tenant deployment working unchanged) — scoping is opt-in per
// user, configured by an administrator in Settings > Users.

func (s *Server) handleGetUserScopes(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	username := r.PathValue("username")

	requester := r.Header.Get("X-User-Name")
	role := r.Header.Get("X-User-Role")
	if requester != username && role != "administrator" && role != "admin" {
		http.Error(w, `{"error":"forbidden: can only view your own scopes"}`, http.StatusForbidden)
		return
	}

	scopes, err := s.db.GetUserScopes(username)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scopes)
}

func (s *Server) handleAddUserScope(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	username := r.PathValue("username")
	var body database.UserScope
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	body.Username = username
	if err := s.db.SaveUserScope(&body); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("user.scope.add", r.Header.Get("X-User-Name"), username, map[string]interface{}{
		"aws_account_id": body.AWSAccountID, "cluster_id": body.ClusterID, "namespace": body.Namespace, "environment": body.Environment,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(body)
}

func (s *Server) handleDeleteUserScope(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	username := r.PathValue("username")
	id, err := strconv.Atoi(r.PathValue("scopeId"))
	if err != nil {
		http.Error(w, `{"error":"invalid scope id"}`, http.StatusBadRequest)
		return
	}
	if err := s.db.DeleteUserScope(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("user.scope.delete", r.Header.Get("X-User-Name"), username, map[string]interface{}{"scope_id": id})
	w.WriteHeader(http.StatusNoContent)
}

// clusterAllowedForUser enforces ABAC on top of RBAC: if the user has no
// scope rows at all, access is governed by role alone (backward
// compatible default). If they have scope rows, at least one must match
// the requested cluster (empty scope fields mean "any").
func (s *Server) clusterAllowedForUser(username, clusterID, awsAccountID, environment string) bool {
	if s.db == nil || username == "" {
		return false
	}
	scopes, err := s.db.GetUserScopes(username)
	if err != nil {
		return false
	}
	if len(scopes) == 0 {
		return true
	}
	for _, sc := range scopes {
		if sc.ClusterID != "" && sc.ClusterID != clusterID {
			continue
		}
		if sc.AWSAccountID != "" && sc.AWSAccountID != awsAccountID {
			continue
		}
		if sc.Environment != "" && sc.Environment != environment {
			continue
		}
		return true
	}
	return false
}

// --- Guardian policies (admin-tunable hard-block config) ---

func (s *Server) handleListGuardianPolicies(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	policies, err := s.db.ListGuardianPolicies()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policies)
}

func (s *Server) handleUpsertGuardianPolicy(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	var body database.GuardianPolicy
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	body.ID = id
	body.UpdatedAt = time.Now()
	if err := s.db.UpsertGuardianPolicy(&body); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("guardian.policy.update", r.Header.Get("X-User-Name"), id, map[string]interface{}{"enabled": body.Enabled})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(body)
}

// --- Audit trail ---

func (s *Server) handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	logs, err := s.db.ListAuditLogs(limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

func intersectScopes(requested, allowed string) string {
	if hasScope(allowed, "admin:full") {
		return requested
	}
	var result []string
	for _, scope := range strings.Split(requested, ",") {
		scope = strings.TrimSpace(scope)
		if hasScope(allowed, scope) {
			result = append(result, scope)
		}
	}
	return strings.Join(result, ",")
}
