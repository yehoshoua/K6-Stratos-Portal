package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/k8s"
)

func (s *Server) handleListClusters(w http.ResponseWriter, r *http.Request) {
	var list []*ClusterConfig
	var err error
	if s.db != nil {
		list, err = s.db.GetClusters()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
			return
		}
	} else {
		list = make([]*ClusterConfig, 0)
	}

	username := r.Header.Get("X-User-Name")
	visible := make([]*ClusterConfig, 0, len(list))
	for _, c := range list {
		// ABAC: if this user has scope rows, only surface clusters that
		// match at least one of them (see clusterAllowedForUser in
		// abac.go). Users with no scope rows see everything their role
		// already permits — scoping is opt-in and fully backward
		// compatible with existing single-tenant deployments.
		if !s.clusterAllowedForUser(username, c.ID, c.AWSAccountID, c.Environment) {
			continue
		}
		s.enrichClusterMetadata(r.Context(), c, true)
		if c.KubernetesVersion == "" {
			c.KubernetesVersion = s.queryKubernetesVersion(c.ID)
		}
		c.K6OperatorInstalled = s.checkK6OperatorInstalled(c.ID)
		visible = append(visible, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(visible)
}

func (s *Server) handleRegisterCluster(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string `json:"name"`
		APIServerURL string `json:"api_server_url"`
		AuthType     string `json:"auth_type"`  // "kubeconfig", "token", or "local"
		RawSecret    string `json:"raw_secret"` // kubeconfig YAML, SA Token, or context name
		CACertBase64 string `json:"ca_cert_base64"`
		Namespaces   string `json:"namespaces"`     // Comma-separated list of namespaces
		AWSAccountID string `json:"aws_account_id"` // AWS Account ID for ECR image resolution
		ClusterARN   string `json:"cluster_arn"`    // Optional EKS cluster ARN
		Region       string `json:"region"`
		Environment  string `json:"environment"`    // dev | stage | prod | sandbox
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	// For local auth type, try to resolve context and api server URL dynamically
	if body.AuthType == "local" {
		if body.RawSecret == "" {
			_, current, err := k8s.GetLocalContexts()
			if err == nil {
				body.RawSecret = current
			}
		}
		if body.APIServerURL == "" && body.RawSecret != "" {
			contexts, _, err := k8s.GetLocalContexts()
			if err == nil {
				for _, ctx := range contexts {
					if ctx.ContextName == body.RawSecret {
						body.APIServerURL = ctx.APIServerURL
						break
					}
				}
			}
		}
	}

	if body.AuthType == "in-cluster" {
		if body.APIServerURL == "" {
			body.APIServerURL = "in-cluster"
		}
		if body.RawSecret == "" {
			body.RawSecret = "in-cluster"
		}
	}

	if body.Name == "" || body.APIServerURL == "" || body.RawSecret == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	// Encrypt the sensitive secret (kubeconfig YAML, SA Token, or local context name)
	encryptedData, err := s.config.Encrypt([]byte(body.RawSecret))
	if err != nil {
		http.Error(w, `{"error":"failed to secure token"}`, http.StatusInternalServerError)
		return
	}

	id := fmt.Sprintf("eks-%d", time.Now().UnixNano())
	region := strings.TrimSpace(body.Region)
	if region == "" {
		region = parseRegion(body.APIServerURL)
	}
	newCluster := &ClusterConfig{
		ID:            id,
		Name:          body.Name,
		APIServerURL:  body.APIServerURL,
		AuthType:      body.AuthType,
		EncryptedData: encryptedData,
		CACertBase64:  body.CACertBase64,
		CreatedAt:     time.Now(),
		Namespaces:    body.Namespaces,
		AWSAccountID:  resolveAWSAccountIDFromARN(body.AWSAccountID, body.ClusterARN),
		Region:        region,
		Environment:   normalizeEnvironment(body.Environment, body.Name),
	}
	s.enrichClusterMetadata(r.Context(), newCluster, false)

	if s.db != nil {
		if err := s.db.SaveCluster(newCluster); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newCluster)
}

func (s *Server) handleUpdateCluster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing cluster id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name         string `json:"name"`
		APIServerURL string `json:"api_server_url"`
		AuthType     string `json:"auth_type"`  // "kubeconfig", "token", or "local"
		RawSecret    string `json:"raw_secret"` // Optional if preserving existing
		CACertBase64 string `json:"ca_cert_base64"`
		Namespaces   string `json:"namespaces"`     // Comma-separated list of namespaces
		AWSAccountID string `json:"aws_account_id"` // AWS Account ID for ECR image resolution
		ClusterARN   string `json:"cluster_arn"`    // Optional EKS cluster ARN
		Region       string `json:"region"`
		Environment  string `json:"environment"`    // dev | stage | prod | sandbox
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Fetch existing cluster
	var existing *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == id {
					existing = c
					break
				}
			}
		}
	}

	if existing == nil {
		http.Error(w, `{"error":"cluster not found"}`, http.StatusNotFound)
		return
	}

	if body.AuthType == "in-cluster" {
		if body.APIServerURL == "" {
			body.APIServerURL = "in-cluster"
		}
		if body.RawSecret == "" && existing.AuthType != "in-cluster" {
			body.RawSecret = "in-cluster"
		}
	}

	// Encrypt the sensitive secret if a new one is provided, otherwise keep existing
	encryptedData := existing.EncryptedData
	if body.RawSecret != "" {
		var err error
		encryptedData, err = s.config.Encrypt([]byte(body.RawSecret))
		if err != nil {
			http.Error(w, `{"error":"failed to secure token"}`, http.StatusInternalServerError)
			return
		}
	}

	awsAccountID := resolveAWSAccountIDFromARN(body.AWSAccountID, body.ClusterARN)
	if awsAccountID == "" {
		awsAccountID = existing.AWSAccountID
	}
	environment := normalizeEnvironment(body.Environment, "")
	if environment == "" {
		environment = existing.Environment
	}
	region := strings.TrimSpace(body.Region)
	if region == "" {
		region = existing.Region
	}
	if region == "" {
		region = parseRegion(body.APIServerURL)
	}

	updatedCluster := &ClusterConfig{
		ID:            id,
		Name:          body.Name,
		APIServerURL:  body.APIServerURL,
		AuthType:      body.AuthType,
		EncryptedData: encryptedData,
		CACertBase64:  body.CACertBase64,
		CreatedAt:     existing.CreatedAt,
		Namespaces:    body.Namespaces,
		AWSAccountID:  awsAccountID,
		Region:        region,
		Environment:   environment,
	}
	s.enrichClusterMetadata(r.Context(), updatedCluster, false)

	if s.db != nil {
		if err := s.db.SaveCluster(updatedCluster); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	// Invalidate client connection cache for this cluster ID
	s.clientCacheMu.Lock()
	delete(s.clientCache, id)
	s.clientCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedCluster)
}

func (s *Server) handleDeleteCluster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing cluster id"}`, http.StatusBadRequest)
		return
	}

	if s.db != nil {
		if err := s.db.DeleteCluster(id); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to delete cluster: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	s.clientCacheMu.Lock()
	delete(s.clientCache, id)
	s.clientCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) getClusterClient(id string) (*k8s.EKSClusterClient, bool, error) {
	s.clientCacheMu.RLock()
	client, cached := s.clientCache[id]
	s.clientCacheMu.RUnlock()
	if cached {
		return client, false, nil
	}

	var clusterConfig *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err != nil {
			return nil, false, fmt.Errorf("failed to get clusters from db: %w", err)
		}
		for _, c := range clusters {
			if c.ID == id {
				clusterConfig = c
				break
			}
		}
	}

	if clusterConfig == nil {
		return nil, false, fmt.Errorf("cluster not found")
	}

	if clusterConfig.AuthType == "mock" || clusterConfig.APIServerURL == "mock" || strings.HasPrefix(clusterConfig.APIServerURL, "mock") {
		return nil, true, nil
	}

	var newClient *k8s.EKSClusterClient
	var err error

	if clusterConfig.AuthType == "in-cluster" {
		newClient, err = k8s.NewClientFromInCluster()
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to in-cluster config: %w", err)
		}
	} else if clusterConfig.AuthType == "eks-assume-role" {
		decryptedRoleARN, err := s.config.Decrypt(clusterConfig.EncryptedData)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decrypt AWS role ARN: %w", err)
		}
		newClient, err = k8s.NewClientFromAssumeRole(context.Background(), clusterConfig.APIServerURL, clusterConfig.CACertBase64, clusterConfig.Name, string(decryptedRoleARN))
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to EKS cluster %s via assumed role: %w", clusterConfig.Name, err)
		}
	} else if clusterConfig.AuthType == "local" {
		decryptedContext, err := s.config.Decrypt(clusterConfig.EncryptedData)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decrypt cluster credentials: %w", err)
		}
		newClient, err = k8s.NewClientFromLocalKubeconfig(string(decryptedContext))
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to local cluster context %s: %w", string(decryptedContext), err)
		}
	} else {
		// Decrypt connection credentials
		decryptedSecret, err := s.config.Decrypt(clusterConfig.EncryptedData)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decrypt cluster credentials: %w", err)
		}

		if clusterConfig.AuthType == "kubeconfig" {
			newClient, err = k8s.NewClientFromKubeconfig(decryptedSecret)
		} else {
			newClient, err = k8s.NewClientFromToken(clusterConfig.APIServerURL, string(decryptedSecret), clusterConfig.CACertBase64)
		}
		if err != nil {
			return nil, false, fmt.Errorf("failed to connect to cluster: %w", err)
		}
	}

	s.clientCacheMu.Lock()
	s.clientCache[id] = newClient
	s.clientCacheMu.Unlock()

	return newClient, false, nil
}

func parseRegion(apiServerURL string) string {
	if strings.Contains(apiServerURL, ".eks.amazonaws.com") {
		parts := strings.Split(apiServerURL, ".")
		for i, part := range parts {
			if part == "eks" && i > 0 {
				return parts[i-1]
			}
		}
	}
	regions := []string{
		"us-east-1", "us-east-2", "us-west-1", "us-west-2",
		"eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1",
		"ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
		"sa-east-1", "ca-central-1",
	}
	for _, r := range regions {
		if strings.Contains(apiServerURL, r) {
			return r
		}
	}
	return "us-east-1"
}

func (s *Server) handleListLocalContexts(w http.ResponseWriter, r *http.Request) {
	contexts, current, err := k8s.GetLocalContexts()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get local contexts: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"contexts":        contexts,
		"current_context": current,
	})
}
