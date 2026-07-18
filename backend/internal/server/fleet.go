package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

// clusterFleetStatus is one row of the unified Fleet Dashboard: a single
// registered cluster's health plus how many k6 workloads are currently
// running on it.
type clusterFleetStatus struct {
	ClusterID   string `json:"cluster_id"`
	ClusterName string `json:"cluster_name"`
	Region      string `json:"region,omitempty"`
	Online      bool   `json:"online"`
	ActiveRuns  int    `json:"active_runs"`
}

// fleetSummary is the payload for the professional-grade "single pane of
// glass" home dashboard: fleet-wide counts plus per-cluster health.
type fleetSummary struct {
	TotalAccounts      int                  `json:"total_accounts"`
	TotalClusters      int                  `json:"total_clusters"`
	ClustersOnline     int                  `json:"clusters_online"`
	ActiveTestRuns     int                  `json:"active_test_runs"`
	ActiveSchedules    int                  `json:"active_schedules"`
	OpenGuardianBlocks int                  `json:"open_guardian_blocks"`
	RecentAlerts       int                  `json:"recent_alerts"`
	Clusters           []clusterFleetStatus `json:"clusters"`
}

// handleFleetSummary aggregates fleet-wide status by fanning out across
// every registered cluster concurrently (via errgroup) instead of the
// sequential per-cluster loops used elsewhere in this codebase. This is
// the data source for the new unified Fleet Dashboard home page.
func (s *Server) handleFleetSummary(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	clusters, err := s.db.GetClusters()
	if err != nil {
		http.Error(w, `{"error":"failed to load clusters"}`, http.StatusInternalServerError)
		return
	}

	accountSet := make(map[string]struct{})
	for _, c := range clusters {
		if c.AWSAccountID != "" {
			accountSet[c.AWSAccountID] = struct{}{}
		}
	}

	statuses := make([]clusterFleetStatus, len(clusters))
	g, gctx := errgroup.WithContext(r.Context())
	for i, c := range clusters {
		i, c := i, c
		g.Go(func() error {
			status := clusterFleetStatus{ClusterID: c.ID, ClusterName: c.Name, Region: c.Region}

			client, isMock, clientErr := s.getClusterClient(c.ID)
			if clientErr != nil {
				statuses[i] = status
				return nil
			}
			status.Online = true

			namespaces := []string{"default"}
			if c.Namespaces != "" {
				var cleaned []string
				for _, p := range strings.Split(c.Namespaces, ",") {
					if t := strings.TrimSpace(p); t != "" {
						cleaned = append(cleaned, t)
					}
				}
				if len(cleaned) > 0 {
					namespaces = cleaned
				}
			}

			if isMock {
				for _, ns := range namespaces {
					for _, item := range s.getMockK6CRDs(ns) {
						if st, ok := item["status"].(map[string]interface{}); ok {
							if stage, _ := st["stage"].(string); strings.ToLower(stage) == "running" {
								status.ActiveRuns++
							}
						}
					}
				}
				statuses[i] = status
				return nil
			}

			for _, ns := range namespaces {
				ctx, cancel := context.WithTimeout(gctx, 2*time.Second)
				items, listErr := client.ListK6CustomResources(ctx, ns)
				cancel()
				if listErr != nil {
					continue
				}
				status.ActiveRuns += len(items)
			}
			statuses[i] = status
			return nil
		})
	}
	_ = g.Wait() // per-cluster errors are already absorbed into status.Online=false

	var mu sync.Mutex
	totalActive := 0
	onlineCount := 0
	for _, st := range statuses {
		mu.Lock()
		if st.Online {
			onlineCount++
		}
		totalActive += st.ActiveRuns
		mu.Unlock()
	}

	activeSchedules := 0
	if schedules, err := s.db.GetSchedules(); err == nil {
		for _, sch := range schedules {
			if sch.Active {
				activeSchedules++
			}
		}
	}

	openBlocks := 0
	if runs, err := s.db.ListValidationRuns(100, 0); err == nil {
		for _, run := range runs {
			if run.OverallVerdict == "block" && !run.Overridden {
				openBlocks++
			}
		}
	}

	recentAlerts := 0
	if alerts, err := s.db.GetAlerts(); err == nil {
		recentAlerts = len(alerts)
	}

	summary := fleetSummary{
		TotalAccounts:      len(accountSet),
		TotalClusters:      len(clusters),
		ClustersOnline:     onlineCount,
		ActiveTestRuns:     totalActive,
		ActiveSchedules:    activeSchedules,
		OpenGuardianBlocks: openBlocks,
		RecentAlerts:       recentAlerts,
		Clusters:           statuses,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
