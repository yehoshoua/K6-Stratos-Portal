package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"k6-bedrock-dashboard/backend/internal/discovery"
)

// handleGetEKSDiscoveryConfig returns whether discovery is configured and what accounts/regions are defined
func (s *Server) handleGetEKSDiscoveryConfig(w http.ResponseWriter, r *http.Request) {
	envVal := os.Getenv("AWS_ACCOUNTS_DISCOVERY")
	externalID := os.Getenv("AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID")
	if externalID == "" {
		externalID = "StratosEKSDiscoveryExternalID" // Default
	}

	configs, err := discovery.ParseAWSAccountsEnv(envVal)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to parse AWS discovery env: %v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled":     envVal != "",
		"raw_env":     envVal,
		"external_id": externalID,
		"accounts":    configs,
	})
}

// handleDiscoverEKSClusters triggers the EKS auto-discovery process
func (s *Server) handleDiscoverEKSClusters(w http.ResponseWriter, r *http.Request) {
	envVal := os.Getenv("AWS_ACCOUNTS_DISCOVERY")
	externalID := os.Getenv("AWS_ACCOUNTS_DISCOVERY_EXTERNAL_ID")
	if externalID == "" {
		externalID = "StratosEKSDiscoveryExternalID" // Default
	}

	configs, err := discovery.ParseAWSAccountsEnv(envVal)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to parse AWS discovery env: %v"}`, err), http.StatusBadRequest)
		return
	}

	if len(configs) == 0 {
		http.Error(w, `{"error":"EKS discovery is not configured. Please define AWS_ACCOUNTS_DISCOVERY env variable."}`, http.StatusBadRequest)
		return
	}

	discovered, err := discovery.DiscoverEKSClusters(r.Context(), configs, externalID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to run EKS discovery: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// Fetch already registered clusters to tag them as "already_registered" in the UI response
	var registeredMap = make(map[string]bool)
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				registeredMap[c.APIServerURL] = true
			}
		}
	}

	type DiscoveredUIResponse struct {
		discovery.DiscoveredCluster
		AlreadyRegistered bool `json:"already_registered"`
	}

	var response []DiscoveredUIResponse
	for _, dc := range discovered {
		response = append(response, DiscoveredUIResponse{
			DiscoveredCluster: dc,
			AlreadyRegistered: registeredMap[dc.APIServerURL],
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleSyncDiscoveredEKSClusters registers a set of auto-discovered EKS clusters into the DB
func (s *Server) handleSyncDiscoveredEKSClusters(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body []struct {
		Name         string `json:"name"`
		APIServerURL string `json:"api_server_url"`
		CACertBase64 string `json:"ca_cert_base64"`
		AWSAccountID string `json:"aws_account_id"`
		Region       string `json:"region"`
		RoleARN      string `json:"role_arn"`
		Environment  string `json:"environment"` // optional custom environment (dev/stage/prod/sandbox)
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	var syncedCount int
	for _, item := range body {
		if item.Name == "" || item.APIServerURL == "" || item.RoleARN == "" {
			continue
		}

		// Encrypt the target assumed Role ARN
		encryptedARN, err := s.config.Encrypt([]byte(item.RoleARN))
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to encrypt credentials: %v"}`, err), http.StatusInternalServerError)
			return
		}

		env := item.Environment
		if env == "" {
			env = "sandbox" // Default fallback
		}

		id := fmt.Sprintf("eks-%d", time.Now().UnixNano())
		newCluster := &ClusterConfig{
			ID:            id,
			Name:          item.Name,
			APIServerURL:  item.APIServerURL,
			AuthType:      "eks-assume-role",
			EncryptedData: encryptedARN,
			CACertBase64:  item.CACertBase64,
			CreatedAt:     time.Now(),
			Namespaces:    "", // Default to empty, let user configure later
			AWSAccountID:  item.AWSAccountID,
			Region:        item.Region,
			Environment:   normalizeEnvironment(env, item.Name),
		}

		s.enrichClusterMetadata(r.Context(), newCluster, false)

		if err := s.db.SaveCluster(newCluster); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save cluster %s: %v"}`, item.Name, err), http.StatusInternalServerError)
			return
		}
		syncedCount++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"count":   syncedCount,
	})
}
