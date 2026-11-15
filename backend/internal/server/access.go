package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"k6-bedrock-dashboard/backend/internal/database"
)

var workspaceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func isAdmin(r *http.Request) bool {
	return r.Header.Get("X-User-Role") == "administrator" || r.Header.Get("X-User-Role") == "admin"
}
func workspaceID(id string) string {
	if id == "" {
		return "default"
	}
	return id
}
func writeRequest(r *http.Request) bool {
	return r.Method != http.MethodGet && r.Method != http.MethodHead
}

func (s *Server) workspaceAccess(r *http.Request, id string, write bool) bool {
	id = workspaceID(id)
	if !workspaceIDPattern.MatchString(id) || s.db == nil {
		return false
	}
	if selected := r.Header.Get("X-Workspace-ID"); selected != "" && selected != id {
		return false
	}
	if isAdmin(r) {
		return true
	}
	role, err := s.db.GetWorkspaceUserRole(id, r.Header.Get("X-User-Name"))
	if err != nil {
		return false
	}
	return role == "administrator" || role == "editor" || (!write && role == "viewer")
}

func scopeMatchesCluster(sc *database.UserScope, c *database.ClusterConfig) bool {
	return (sc.ClusterID == "" || sc.ClusterID == c.ID) &&
		(sc.AWSAccountID == "" || sc.AWSAccountID == c.AWSAccountID) &&
		(sc.Environment == "" || sc.Environment == normalizeEnvironment(c.Environment, c.Name))
}

// nil namespaces means unrestricted; a non-nil empty set means denied.
func (s *Server) clusterAccess(r *http.Request, id string, write bool) (*database.ClusterConfig, []string, error) {
	if s.db == nil {
		return nil, nil, fmt.Errorf("database unavailable")
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		return nil, nil, err
	}
	var c *database.ClusterConfig
	for _, item := range clusters {
		if item.ID == id {
			c = item
			break
		}
	}
	if c == nil || !s.workspaceAccess(r, c.WorkspaceID, write) {
		return nil, nil, fmt.Errorf("cluster access denied")
	}
	scopes, err := s.db.GetUserScopes(r.Header.Get("X-User-Name"))
	if err != nil {
		return nil, nil, err
	}
	var allowed []string
	if len(scopes) > 0 {
		allowed = []string{}
		matched := false
		for _, sc := range scopes {
			if scopeMatchesCluster(sc, c) {
				matched = true
				if sc.Namespace == "" {
					allowed = nil
					break
				}
				allowed = append(allowed, sc.Namespace)
			}
		}
		if !matched {
			return nil, nil, fmt.Errorf("cluster access denied")
		}
	}
	configured := []string{}
	for _, ns := range strings.Split(c.Namespaces, ",") {
		if ns = strings.TrimSpace(ns); ns != "" {
			configured = append(configured, ns)
		}
	}
	if len(configured) > 0 {
		if allowed == nil {
			allowed = configured
		} else {
			intersection := []string{}
			for _, ns := range allowed {
				if containsString(configured, ns) {
					intersection = append(intersection, ns)
				}
			}
			allowed = intersection
		}
	}
	if allowed != nil && len(allowed) == 0 {
		return nil, nil, fmt.Errorf("namespace access denied")
	}
	return c, allowed, nil
}
func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func (s *Server) authorizeCluster(r *http.Request, id, ns string, write bool) error {
	_, allowed, err := s.clusterAccess(r, id, write)
	if err != nil {
		return err
	}
	if ns != "" && ns != "all" && allowed != nil && !containsString(allowed, ns) {
		return fmt.Errorf("namespace access denied")
	}
	return nil
}
func (s *Server) visibleClusters(r *http.Request) ([]*database.ClusterConfig, error) {
	clusters, err := s.db.GetClusters()
	if err != nil {
		return nil, err
	}
	visible := make([]*database.ClusterConfig, 0, len(clusters))
	for _, c := range clusters {
		if _, _, err := s.clusterAccess(r, c.ID, false); err == nil {
			visible = append(visible, c)
		}
	}
	return visible, nil
}
func (s *Server) requestNamespaces(r *http.Request, id string) ([]string, error) {
	_, allowed, err := s.clusterAccess(r, id, false)
	if err != nil {
		return nil, err
	}
	ns := r.URL.Query().Get("namespace")
	if ns == "all" {
		if allowed == nil {
			return []string{""}, nil
		}
		return allowed, nil
	}
	if ns == "" {
		ns = "default"
	}
	if allowed != nil && !containsString(allowed, ns) {
		return nil, fmt.Errorf("namespace access denied")
	}
	return []string{ns}, nil
}
func (s *Server) scheduleAccess(r *http.Request, sched *database.TestSchedule, write bool) bool {
	if sched == nil || sched.Namespace == "" || sched.Namespace == "all" || s.authorizeCluster(r, sched.ClusterID, sched.Namespace, write) != nil {
		return false
	}
	tmpl, err := s.db.GetTemplate(sched.TemplateID)
	return err == nil && tmpl != nil && s.workspaceAccess(r, tmpl.WorkspaceID, false)
}

// Check every resource identifier before entering handlers, including payload references.
func (s *Server) authorizeRequest(w http.ResponseWriter, r *http.Request) bool {
	deny := func() bool { s.writeError(w, 403, "resource access denied"); return false }
	if ws := r.Header.Get("X-Workspace-ID"); ws != "" && !workspaceIDPattern.MatchString(ws) {
		return deny()
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/k8s/clusters/") {
		ns := ""
		for _, resource := range []string{"/crds", "/configmaps", "/pods", "/batch-workloads"} {
			if strings.Contains(path, resource) {
				ns = r.URL.Query().Get("namespace")
				if ns == "" {
					ns = "default"
				}
				break
			}
		}
		if writeRequest(r) && ns == "all" {
			return deny()
		}
		if s.authorizeCluster(r, r.PathValue("id"), ns, writeRequest(r)) != nil {
			return deny()
		}
		if c := s.storedCluster(r.PathValue("id")); c != nil {
			r.Header.Set("X-Workspace-ID", workspaceID(c.WorkspaceID))
		}
	}
	if strings.HasPrefix(path, "/api/settings/templates/") {
		t, err := s.db.GetTemplate(r.PathValue("id"))
		if err != nil || t == nil || !s.workspaceAccess(r, t.WorkspaceID, writeRequest(r)) {
			return deny()
		}
		r.Header.Set("X-Workspace-ID", workspaceID(t.WorkspaceID))
	}
	if strings.HasPrefix(path, "/api/settings/schedules/") {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			return deny()
		}
		sched, err := s.db.GetSchedule(id)
		if err != nil || !s.scheduleAccess(r, sched, writeRequest(r)) {
			return deny()
		}
	}
	if strings.HasPrefix(path, "/api/v1/guardian/runs/") {
		run, err := s.db.GetValidationRun(r.PathValue("id"))
		if err != nil || run == nil {
			return deny()
		}
		if run.ClusterID != "" && s.authorizeCluster(r, run.ClusterID, run.Namespace, false) != nil {
			return deny()
		}
		if !isAdmin(r) && run.RequestedBy != r.Header.Get("X-User-Name") {
			return deny()
		}
	}
	if (r.Method == "POST" || r.Method == "PUT") && (strings.HasPrefix(path, "/api/settings/templates") || path == "/api/settings/schedules" || (r.Method == "PUT" && strings.HasPrefix(path, "/api/settings/schedules/")) || path == "/api/v1/guardian/validate") {
		// These are small JSON configuration bodies, not multipart uploads.
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
		if err != nil {
			s.writeError(w, 413, "request too large")
			return false
		}
		r.Body = io.NopCloser(bytes.NewReader(data))
		var body struct {
			ClusterID         string `json:"cluster_id"`
			Namespace         string `json:"namespace"`
			TemplateID        string `json:"template_id"`
			ScheduleClusterID string `json:"schedule_cluster_id"`
			ScheduleNamespace string `json:"schedule_namespace"`
			ScheduleEnabled   bool   `json:"schedule_enabled"`
			SubjectType       string `json:"subject_type"`
		}
		if json.Unmarshal(data, &body) != nil {
			s.writeError(w, 400, "invalid request body")
			return false
		}
		if strings.HasPrefix(path, "/api/settings/templates") {
			if body.ScheduleEnabled && r.Header.Get("X-Auth-Kind") == "token" && !hasScope(r.Header.Get("X-User-Scopes"), "admin:full") && !hasScope(r.Header.Get("X-User-Scopes"), "schedules:create") {
				return deny()
			}
			ws := workspaceID(r.Header.Get("X-Workspace-ID"))
			if !s.workspaceAccess(r, ws, true) {
				return deny()
			}
			r.Header.Set("X-Workspace-ID", ws)
			if body.ScheduleEnabled && (body.ScheduleClusterID == "" || body.ScheduleNamespace == "" || body.ScheduleNamespace == "all" || s.authorizeCluster(r, body.ScheduleClusterID, body.ScheduleNamespace, true) != nil) {
				return deny()
			}
		}
		if body.ClusterID != "" && s.authorizeCluster(r, body.ClusterID, body.Namespace, true) != nil {
			return deny()
		}
		if strings.HasPrefix(path, "/api/settings/schedules") && body.TemplateID != "" {
			if body.Namespace == "" || body.Namespace == "all" {
				return deny()
			}
			cluster := s.storedCluster(body.ClusterID)
			if cluster == nil {
				return deny()
			}
			r.Header.Set("X-Workspace-ID", workspaceID(cluster.WorkspaceID))
			t, err := s.db.GetTemplate(body.TemplateID)
			if err != nil || t == nil || !s.workspaceAccess(r, t.WorkspaceID, false) {
				return deny()
			}
		}
		if path == "/api/v1/guardian/validate" && (body.SubjectType == "rbac_change" || body.SubjectType == "token_grant") && !isAdmin(r) {
			return deny()
		}
	}
	return true
}

// API tokens must satisfy the exact operation scope. A role never bypasses it.
func requiredTokenScope(r *http.Request) string {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/v1/me/tokens") {
		return "session-only"
	}
	if p == "/api/auth/me" {
		return ""
	}
	if strings.HasPrefix(p, "/api/influx/") {
		return "metrics:read"
	}
	if strings.Contains(p, "/pods/") && strings.HasSuffix(p, "/logs") {
		return "logs:read"
	}
	if strings.Contains(p, "/pods/") && strings.HasSuffix(p, "/metrics") {
		return "metrics:read"
	}
	if strings.HasPrefix(p, "/api/v1/guardian/policies") || strings.HasSuffix(p, "/override") {
		return "admin:full"
	}
	if strings.HasPrefix(p, "/api/v1/guardian/") {
		if writeRequest(r) {
			return "tests:launch"
		}
		return "tests:read"
	}
	if !writeRequest(r) {
		if strings.Contains(p, "/crds") || strings.Contains(p, "/batch-workloads") || strings.Contains(p, "/configmaps") || strings.HasSuffix(p, "/pods") || p == "/api/k8s/active-tests" {
			return "tests:read"
		}
		if strings.HasPrefix(p, "/api/k8s/") || p == "/api/v1/fleet/summary" {
			return "clusters:read"
		}
		if strings.HasPrefix(p, "/api/settings/templates") || strings.HasPrefix(p, "/api/settings/schedules") || p == "/api/settings/defaults" || strings.HasPrefix(p, "/api/files") {
			return "tests:read"
		}
		if strings.HasPrefix(p, "/api/workspaces") || strings.HasPrefix(p, "/api/v1/users/") {
			return "clusters:read"
		}
		if p == "/api/v1/audit-logs" {
			return "audit:read"
		}
		return "admin:full"
	}
	if strings.HasPrefix(p, "/api/settings/schedules") {
		if strings.HasSuffix(p, "/run") {
			return "tests:launch"
		}
		return "schedules:create"
	}
	if strings.HasPrefix(p, "/api/settings/templates") || strings.HasPrefix(p, "/api/files") || strings.Contains(p, "/configmaps") {
		if r.Method == "POST" {
			return "tests:create"
		}
		return "tests:update"
	}
	if strings.Contains(p, "/crds") {
		if r.Method == "DELETE" {
			return "tests:update"
		}
		return "tests:launch"
	}
	if strings.Contains(p, "/batch-workloads/") {
		return "schedules:create"
	}
	if p == "/api/settings/defaults" {
		return "tests:update"
	}
	return "admin:full"
}

func (s *Server) filterNamespaceNames(r *http.Request, id string, names []string) []string {
	result := []string{}
	for _, ns := range names {
		if s.authorizeCluster(r, id, ns, false) == nil {
			result = append(result, ns)
		}
	}
	return result
}
