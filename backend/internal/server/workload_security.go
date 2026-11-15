package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/guardian"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"os"
	"path/filepath"
)

type workloadRequest struct {
	Name            string                 `json:"name"`
	ScriptContent   string                 `json:"scriptContent"`
	Schedule        bool                   `json:"schedule"`
	CronExpression  string                 `json:"cronExpression"`
	ResourceKind    string                 `json:"resource_kind"`
	Active          *bool                  `json:"active"`
	Spec            map[string]interface{} `json:"spec"`
	ValidationRunID string                 `json:"validation_run_id"`
	DatasetFiles    []string               `json:"datasetFiles"`
}

func (s *Server) storedCluster(id string) *database.ClusterConfig {
	if s.db == nil {
		return nil
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		return nil
	}
	for _, c := range clusters {
		if c.ID == id {
			return c
		}
	}
	return nil
}
func (s *Server) workloadSubject(ctx context.Context, clusterID, namespace string, payload workloadRequest, actor string) (guardian.Subject, error) {
	// Normalize the complete workload in both preflight and execution paths.
	if payload.ResourceKind == "" {
		payload.ResourceKind = "testrun"
	}
	payload.ValidationRunID = ""
	if payload.DatasetFiles == nil {
		payload.DatasetFiles = []string{}
	}
	c := s.storedCluster(clusterID)
	if c == nil {
		return guardian.Subject{}, fmt.Errorf("cluster not found")
	}
	if runner, ok := payload.Spec["runner"].(map[string]interface{}); ok {
		if image, ok := runner["image"].(string); ok {
			runner["image"] = resolveClusterImage(image, c)
		}
	}
	script := payload.ScriptContent
	if script == "" {
		if specScript, ok := payload.Spec["script"].(map[string]interface{}); ok {
			if cm, ok := specScript["configMap"].(map[string]interface{}); ok {
				name, _ := cm["name"].(string)
				file, _ := cm["file"].(string)
				if name != "" {
					client, mock, err := s.getClusterClient(clusterID)
					if err != nil {
						return guardian.Subject{}, err
					}
					if !mock {
						configMap, err := client.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
						if err != nil {
							return guardian.Subject{}, fmt.Errorf("cannot validate referenced script")
						}
						script = configMap.Data[file]
						if script == "" {
							return guardian.Subject{}, fmt.Errorf("referenced script is empty or missing")
						}
					}
				}
			}
		}
	}
	subject := s.buildTestLaunchSubject(clusterID, namespace, payload.Name, script, payload.CronExpression, payload.Spec, actor)
	raw, err := json.Marshal(payload)
	if err != nil {
		return subject, err
	}
	var normalized map[string]interface{}
	if err = json.Unmarshal(raw, &normalized); err != nil {
		return subject, err
	}
	subject.Payload["workload"] = normalized
	// Bind validation to dataset contents as well as names; paths use the cluster's trusted workspace.
	files := map[string]string{}
	for _, name := range payload.DatasetFiles {
		if name != filepath.Base(name) || name == "." || name == ".." {
			return subject, fmt.Errorf("invalid dataset filename")
		}
		data, err := os.ReadFile(filepath.Join("data", "uploads", workspaceID(c.WorkspaceID), name))
		if err != nil {
			return subject, fmt.Errorf("dataset not found")
		}
		digest := sha256.Sum256(data)
		files[name] = hex.EncodeToString(digest[:])
	}
	subject.Payload["datasets"] = files
	return subject, nil
}
func (s *Server) templateScheduleSubject(t *database.K6Template, actor string) guardian.Subject {
	environment := ""
	if c := s.storedCluster(t.ScheduleClusterID); c != nil {
		environment = normalizeEnvironment(c.Environment, c.Name)
	}
	return guardian.Subject{Type: guardian.SubjectScheduleNew, Ref: t.Name, RequestedBy: actor, ClusterID: t.ScheduleClusterID, Namespace: t.ScheduleNamespace, Environment: environment, Payload: map[string]interface{}{"scriptContent": t.ScriptContent, "cpuLimit": t.CPULimit, "memLimit": t.MemLimit, "parallelism": t.Parallelism, "runnerImage": t.RunnerImage, "cronExpression": t.ScheduleCronExpression}}
}
