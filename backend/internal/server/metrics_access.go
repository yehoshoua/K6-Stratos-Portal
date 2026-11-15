package server

import (
	"k6-bedrock-dashboard/backend/internal/influx"
	"net/http"
)

// Metrics tags must identify an authorized cluster AND namespace. Untagged legacy
// data is visible only to an unrestricted platform administrator.
func (s *Server) metricRunAllowed(r *http.Request, run influx.TestRunSummary) bool {
	if run.Cluster == "" || run.Namespace == "" {
		return s.unrestrictedAdmin(r)
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		return false
	}
	matched := false
	for _, c := range clusters {
		if c.ID == run.Cluster || c.Name == run.Cluster {
			matched = true
			if s.authorizeCluster(r, c.ID, run.Namespace, false) != nil {
				return false
			}
		}
	}
	// Names are not unique across workspaces: ambiguous tags must never
	// authorize data from a cluster the caller cannot access.
	return matched
}
func (s *Server) unrestrictedAdmin(r *http.Request) bool {
	if !isAdmin(r) || r.Header.Get("X-Workspace-ID") != "" {
		return false
	}
	scopes, err := s.db.GetUserScopes(r.Header.Get("X-User-Name"))
	return err == nil && len(scopes) == 0
}
func (s *Server) authorizeMetricQuery(w http.ResponseWriter, r *http.Request) bool {
	if s.unrestrictedAdmin(r) {
		return true
	}
	cluster, namespace := r.URL.Query().Get("cluster"), r.URL.Query().Get("namespace")
	if cluster == "" || namespace == "" || namespace == "all" || !s.metricRunAllowed(r, influx.TestRunSummary{Cluster: cluster, Namespace: namespace}) {
		s.writeError(w, 403, "metrics require an authorized cluster and namespace")
		return false
	}
	return true
}
