package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/k8s"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func (s *Server) handleListCRDs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		json.NewEncoder(w).Encode(s.getMockK6CRDs(namespace))
		return
	}

	var resultList []interface{}

	crdItems, err := client.ListK6CustomResources(r.Context(), namespace)
	if err == nil {
		for _, item := range crdItems {
			resultList = append(resultList, item.Object)
		}
	}

	if resultList == nil {
		resultList = []interface{}{}
	}

	json.NewEncoder(w).Encode(resultList)
}

func (s *Server) handleListBatchWorkloads(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		json.NewEncoder(w).Encode([]interface{}{
			map[string]interface{}{
				"kind": "CronJob",
				"metadata": map[string]interface{}{
					"name":              "mock-k6-cron",
					"namespace":         "default",
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": map[string]interface{}{
					"parallelism": 1,
					"schedule":    "0 */6 * * *",
				},
				"status": map[string]interface{}{
					"stage":     "scheduled",
					"active":    true,
					"suspended": false,
				},
			},
		})
		return
	}

	var resultList []interface{}

	cjList, err := client.Clientset.BatchV1().CronJobs(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err == nil {
		for _, cj := range cjList.Items {
			resultList = append(resultList, s.mapCronJobToUI(&cj))
		}
	}

	jobList, err := client.Clientset.BatchV1().Jobs(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err == nil {
		for _, job := range jobList.Items {
			resultList = append(resultList, s.mapJobToUI(&job))
		}
	}

	if resultList == nil {
		resultList = []interface{}{}
	}

	json.NewEncoder(w).Encode(resultList)
}

func (s *Server) handleToggleBatchCronJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"kind": "CronJob",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
			"status": map[string]interface{}{
				"active":    true,
				"suspended": false,
				"stage":     "scheduled",
			},
		})
		return
	}

	cj, err := client.Clientset.BatchV1().CronJobs(namespace).Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get CronJob: %v"}`, err), http.StatusNotFound)
		return
	}

	suspended := cj.Spec.Suspend != nil && *cj.Spec.Suspend
	next := !suspended
	cj.Spec.Suspend = &next

	updated, err := client.Clientset.BatchV1().CronJobs(namespace).Update(r.Context(), cj, metav1.UpdateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update CronJob: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.mapCronJobToUI(updated))
}

func (s *Server) handleCreateCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var payload struct {
		Name            string                 `json:"name"`
		ScriptContent   string                 `json:"scriptContent"`
		Schedule        bool                   `json:"schedule"`
		CronExpression  string                 `json:"cronExpression"`
		ResourceKind    string                 `json:"resource_kind"`
		Active          *bool                  `json:"active"`
		Spec            map[string]interface{} `json:"spec"`
		ValidationRunID string                 `json:"validation_run_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	resourceKind := strings.ToLower(strings.TrimSpace(payload.ResourceKind))
	if resourceKind == "" {
		resourceKind = "testrun"
	}

	if err := s.guardianGate(r.Context(), r, s.buildTestLaunchSubject(id, namespace, payload.Name, payload.ScriptContent, payload.CronExpression, payload.Spec, r.Header.Get("X-User-Name")), payload.ValidationRunID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusPreconditionFailed)
		return
	}

	configMapName := "cm-" + payload.Name
	scriptFile := "script.js"

	specMap := payload.Spec
	if resourceKind == "testrun" && specMap == nil {
		specMap = map[string]interface{}{}
	}
	if specMap != nil {
		if scriptMap, ok := specMap["script"].(map[string]interface{}); ok {
			if cmMap, ok := scriptMap["configMap"].(map[string]interface{}); ok {
				if name, ok := cmMap["name"].(string); ok && name != "" {
					configMapName = name
				}
				if file, ok := cmMap["file"].(string); ok && file != "" {
					scriptFile = file
				}
			}
		}
	}

	if payload.ScriptContent != "" && !isMock {
		cm := &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      configMapName,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Data: map[string]string{
				scriptFile: payload.ScriptContent,
			},
		}

		cmClient := client.Clientset.CoreV1().ConfigMaps(namespace)
		if err := applyConfigMap(r.Context(), cmClient, cm); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to apply ConfigMap: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		switch resourceKind {
		case "testrun":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"apiVersion": "k6.io/v1alpha1",
				"kind":       "TestRun",
				"metadata": map[string]interface{}{
					"name":              payload.Name,
					"namespace":         namespace,
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": payload.Spec,
				"status": map[string]interface{}{
					"stage": "running",
				},
			})
		case "cronjob":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"kind": "CronJob",
				"metadata": map[string]interface{}{
					"name":              payload.Name,
					"namespace":         namespace,
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": map[string]interface{}{
					"parallelism": 1,
					"schedule":    payload.CronExpression,
				},
				"status": map[string]interface{}{
					"stage": "scheduled",
				},
			})
		default:
			json.NewEncoder(w).Encode(map[string]interface{}{
				"kind": "Job",
				"metadata": map[string]interface{}{
					"name":              payload.Name,
					"namespace":         namespace,
					"creationTimestamp": time.Now().Format(time.RFC3339),
				},
				"spec": map[string]interface{}{
					"parallelism": 1,
				},
				"status": map[string]interface{}{
					"stage": "running",
				},
			})
		}
		return
	}

	clusterConfig := s.getClusterConfig(id)

	var defaultEnvEntries []runDefaultEnvVar
	if s.db != nil {
		envRaw, _ := s.db.GetSetting("run_default_env_vars")
		if envRaw != "" {
			_ = json.Unmarshal([]byte(envRaw), &defaultEnvEntries)
		}
	}

	var parallelismVal int32 = 1
	if resourceKind == "testrun" && specMap != nil {
		if p, ok := specMap["parallelism"].(float64); ok {
			parallelismVal = int32(p)
		} else if p, ok := specMap["parallelism"].(int); ok {
			parallelismVal = int32(p)
		}
	} else if resourceKind != "testrun" {
		parallelismVal = 1
	}

	image := "grafana/k6:latest"
	var limits corev1.ResourceList
	if specMap != nil {
		if runnerMap, ok := specMap["runner"].(map[string]interface{}); ok {
			if specRunnerImage, ok := runnerMap["image"].(string); ok && specRunnerImage != "" {
				resolvedImage := resolveClusterImage(specRunnerImage, clusterConfig)
				image = resolvedImage
				runnerMap["image"] = resolvedImage
			}
			if resMap, ok := runnerMap["resources"].(map[string]interface{}); ok {
				if limMap, ok := resMap["limits"].(map[string]interface{}); ok {
					limits = make(corev1.ResourceList)
					if cpuVal, ok := limMap["cpu"].(string); ok && cpuVal != "" {
						if q, err := resource.ParseQuantity(cpuVal); err == nil {
							limits[corev1.ResourceCPU] = q
						}
					}
					if memVal, ok := limMap["memory"].(string); ok && memVal != "" {
						if q, err := resource.ParseQuantity(memVal); err == nil {
							limits[corev1.ResourceMemory] = q
						}
					}
				}
			}

			if resourceKind == "testrun" && runnerMap["env"] == nil && len(defaultEnvEntries) > 0 {
				envPayload := make([]map[string]string, 0, len(defaultEnvEntries))
				for _, entry := range defaultEnvEntries {
					key := strings.TrimSpace(entry.Key)
					if key == "" {
						continue
					}
					envPayload = append(envPayload, map[string]string{
						"name":  key,
						"value": entry.Value,
					})
				}
				if len(envPayload) > 0 {
					runnerMap["env"] = envPayload
				}
			}
		}
	}

	resources := corev1.ResourceRequirements{}
	if len(limits) > 0 {
		resources.Limits = limits
	}

	var runArgs []string
	runArgs = append(runArgs, "run", "/script/"+scriptFile)
	if specMap != nil {
		if argsVal, ok := specMap["arguments"].(string); ok && argsVal != "" {
			parts := strings.Fields(argsVal)
			runArgs = append(runArgs, parts...)
		}
	}

	var envVars []corev1.EnvVar
	if specMap != nil {
		if runnerMap, ok := specMap["runner"].(map[string]interface{}); ok {
			if envList, ok := runnerMap["env"].([]interface{}); ok {
				for _, item := range envList {
					entry, ok := item.(map[string]interface{})
					if !ok {
						continue
					}
					name := ""
					if keyVal, ok := entry["name"].(string); ok {
						name = strings.TrimSpace(keyVal)
					} else if keyVal, ok := entry["key"].(string); ok {
						name = strings.TrimSpace(keyVal)
					}
					if name == "" {
						continue
					}
					val := ""
					if valueVal, ok := entry["value"].(string); ok {
						val = valueVal
					}
					envVars = append(envVars, corev1.EnvVar{Name: name, Value: val})
				}
			}
		}
	}

	if len(envVars) == 0 && len(defaultEnvEntries) > 0 {
		for _, entry := range defaultEnvEntries {
			key := strings.TrimSpace(entry.Key)
			if key == "" {
				continue
			}
			envVars = append(envVars, corev1.EnvVar{
				Name:  key,
				Value: entry.Value,
			})
		}
	}
	jobSpec := batchv1.JobSpec{
		Parallelism: &parallelismVal,
		Template: corev1.PodTemplateSpec{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: corev1.PodSpec{
				RestartPolicy: corev1.RestartPolicyNever,
				Containers: []corev1.Container{
					{
						Name:      "k6-runner",
						Image:     image,
						Args:      runArgs,
						Env:       envVars,
						Resources: resources,
						VolumeMounts: []corev1.VolumeMount{
							{
								Name:      "script-volume",
								MountPath: "/script",
							},
						},
					},
				},
				Volumes: []corev1.Volume{
					{
						Name: "script-volume",
						VolumeSource: corev1.VolumeSource{
							ConfigMap: &corev1.ConfigMapVolumeSource{
								LocalObjectReference: corev1.LocalObjectReference{
									Name: configMapName,
								},
							},
						},
					},
				},
			},
		},
	}

	switch resourceKind {
	case "testrun":
		resourceName := sanitizeDNSLabel(payload.Name, maxDNSLabelLength)
		if resourceName == "" {
			http.Error(w, `{"error":"invalid test run name"}`, http.StatusBadRequest)
			return
		}
		obj := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "k6.io/v1alpha1",
				"kind":       "TestRun",
				"metadata": map[string]interface{}{
					"name":      resourceName,
					"namespace": namespace,
					"labels": map[string]string{
						"k6s": "enabled",
					},
				},
				"spec": specMap,
			},
		}
		created, err := client.CreateK6CustomResource(r.Context(), namespace, obj)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to create TestRun: %v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(created.Object)
	case "cronjob":
		if payload.CronExpression == "" {
			http.Error(w, `{"error":"missing cron expression"}`, http.StatusBadRequest)
			return
		}
		cronJob := &batchv1.CronJob{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "batch/v1",
				Kind:       "CronJob",
			},
			ObjectMeta: metav1.ObjectMeta{
				Name:      payload.Name,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: batchv1.CronJobSpec{
				Schedule:          payload.CronExpression,
				ConcurrencyPolicy: batchv1.ForbidConcurrent,
				JobTemplate: batchv1.JobTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{
						Labels: map[string]string{
							"k6s": "enabled",
						},
					},
					Spec: jobSpec,
				},
			},
		}
		if payload.Active != nil {
			suspend := !*payload.Active
			cronJob.Spec.Suspend = &suspend
		}

		existingCronJob, err := client.Clientset.BatchV1().CronJobs(namespace).Get(r.Context(), payload.Name, metav1.GetOptions{})
		if err == nil {
			cronJob.ResourceVersion = existingCronJob.ResourceVersion
			updatedCronJob, updateErr := client.Clientset.BatchV1().CronJobs(namespace).Update(r.Context(), cronJob, metav1.UpdateOptions{})
			if updateErr != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to update CronJob: %v"}`, updateErr), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(s.mapCronJobToUI(updatedCronJob))
			return
		}

		createdCronJob, err := client.Clientset.BatchV1().CronJobs(namespace).Create(r.Context(), cronJob, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to create CronJob: %v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.mapCronJobToUI(createdCronJob))
	default:
		job := &batchv1.Job{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "batch/v1",
				Kind:       "Job",
			},
			ObjectMeta: metav1.ObjectMeta{
				Name:      payload.Name,
				Namespace: namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Spec: jobSpec,
		}

		existingJob, err := client.Clientset.BatchV1().Jobs(namespace).Get(r.Context(), payload.Name, metav1.GetOptions{})
		if err == nil {
			job.ResourceVersion = existingJob.ResourceVersion
			updatedJob, updateErr := client.Clientset.BatchV1().Jobs(namespace).Update(r.Context(), job, metav1.UpdateOptions{})
			if updateErr == nil {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(s.mapJobToUI(updatedJob))
				return
			}
			_ = client.Clientset.BatchV1().Jobs(namespace).Delete(r.Context(), payload.Name, metav1.DeleteOptions{})
		}

		createdJob, err := client.Clientset.BatchV1().Jobs(namespace).Create(r.Context(), job, metav1.CreateOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to create Job: %v"}`, err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.mapJobToUI(createdJob))
	}
}

func (s *Server) handleDeleteCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	s.audit("testrun.delete", r.Header.Get("X-User-Name"), fmt.Sprintf("%s/%s/%s", id, namespace, name), nil)

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	// Try deleting as a Job
	jobErr := client.Clientset.BatchV1().Jobs(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if jobErr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	// Try deleting as a CronJob
	cjErr := client.Clientset.BatchV1().CronJobs(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if cjErr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	err = client.DeleteK6CustomResource(r.Context(), namespace, name)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) mapJobToUI(job *batchv1.Job) map[string]interface{} {
	cmName := ""
	cmFile := ""
	if len(job.Spec.Template.Spec.Volumes) > 0 {
		for _, vol := range job.Spec.Template.Spec.Volumes {
			if vol.ConfigMap != nil {
				cmName = vol.ConfigMap.Name
				break
			}
		}
	}
	if len(job.Spec.Template.Spec.Containers) > 0 && len(job.Spec.Template.Spec.Containers[0].Args) >= 2 {
		args := job.Spec.Template.Spec.Containers[0].Args
		if args[0] == "run" {
			cmFile = strings.TrimPrefix(args[1], "/script/")
		}
	}

	parallelism := 1
	if job.Spec.Parallelism != nil {
		parallelism = int(*job.Spec.Parallelism)
	}

	image := ""
	cpuLimit := ""
	memLimit := ""
	var envList []map[string]string
	if len(job.Spec.Template.Spec.Containers) > 0 {
		container := job.Spec.Template.Spec.Containers[0]
		image = container.Image
		if cpuQty, ok := container.Resources.Limits[corev1.ResourceCPU]; ok {
			cpuLimit = cpuQty.String()
		}
		if memQty, ok := container.Resources.Limits[corev1.ResourceMemory]; ok {
			memLimit = memQty.String()
		}
		if len(container.Env) > 0 {
			for _, envVar := range container.Env {
				envList = append(envList, map[string]string{
					"key":   envVar.Name,
					"value": envVar.Value,
				})
			}
		}
	}

	argsText := ""
	if len(job.Spec.Template.Spec.Containers) > 0 && len(job.Spec.Template.Spec.Containers[0].Args) > 2 {
		args := job.Spec.Template.Spec.Containers[0].Args
		argsText = strings.Join(args[2:], " ")
	}

	stage := "running"
	if job.Status.Succeeded > 0 {
		stage = "finished"
	} else if job.Status.Failed > 0 {
		stage = "failed"
	}

	runnerSpec := map[string]interface{}{
		"image": image,
	}
	if cpuLimit != "" || memLimit != "" {
		limits := map[string]interface{}{}
		if cpuLimit != "" {
			limits["cpu"] = cpuLimit
		}
		if memLimit != "" {
			limits["memory"] = memLimit
		}
		runnerSpec["resources"] = map[string]interface{}{
			"limits": limits,
		}
	}
	if len(envList) > 0 {
		runnerSpec["env"] = envList
	}

	return map[string]interface{}{
		"kind": "Job",
		"metadata": map[string]interface{}{
			"name":              job.Name,
			"namespace":         job.Namespace,
			"creationTimestamp": job.CreationTimestamp.Time.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"parallelism": parallelism,
			"script": map[string]interface{}{
				"configMap": map[string]interface{}{
					"name": cmName,
					"file": cmFile,
				},
			},
			"runner":    runnerSpec,
			"arguments": argsText,
		},
		"status": map[string]interface{}{
			"stage": stage,
		},
	}
}

func (s *Server) mapCronJobToUI(cj *batchv1.CronJob) map[string]interface{} {
	cmName := ""
	cmFile := ""
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Volumes) > 0 {
		for _, vol := range cj.Spec.JobTemplate.Spec.Template.Spec.Volumes {
			if vol.ConfigMap != nil {
				cmName = vol.ConfigMap.Name
				break
			}
		}
	}
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 && len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args) >= 2 {
		args := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args
		if args[0] == "run" {
			cmFile = strings.TrimPrefix(args[1], "/script/")
		}
	}

	parallelism := 1
	if cj.Spec.JobTemplate.Spec.Parallelism != nil {
		parallelism = int(*cj.Spec.JobTemplate.Spec.Parallelism)
	}

	image := ""
	cpuLimit := ""
	memLimit := ""
	var envList []map[string]string
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 {
		container := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0]
		image = container.Image
		if cpuQty, ok := container.Resources.Limits[corev1.ResourceCPU]; ok {
			cpuLimit = cpuQty.String()
		}
		if memQty, ok := container.Resources.Limits[corev1.ResourceMemory]; ok {
			memLimit = memQty.String()
		}
		if len(container.Env) > 0 {
			for _, envVar := range container.Env {
				envList = append(envList, map[string]string{
					"key":   envVar.Name,
					"value": envVar.Value,
				})
			}
		}
	}

	argsText := ""
	if len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers) > 0 && len(cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args) > 2 {
		args := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Args
		argsText = strings.Join(args[2:], " ")
	}

	runnerSpec := map[string]interface{}{
		"image": image,
	}
	if cpuLimit != "" || memLimit != "" {
		limits := map[string]interface{}{}
		if cpuLimit != "" {
			limits["cpu"] = cpuLimit
		}
		if memLimit != "" {
			limits["memory"] = memLimit
		}
		runnerSpec["resources"] = map[string]interface{}{
			"limits": limits,
		}
	}
	if len(envList) > 0 {
		runnerSpec["env"] = envList
	}

	suspended := cj.Spec.Suspend != nil && *cj.Spec.Suspend
	stage := "scheduled"
	if suspended {
		stage = "inactive"
	}

	return map[string]interface{}{
		"kind": "CronJob",
		"metadata": map[string]interface{}{
			"name":              cj.Name,
			"namespace":         cj.Namespace,
			"creationTimestamp": cj.CreationTimestamp.Time.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"parallelism": parallelism,
			"schedule":    cj.Spec.Schedule,
			"script": map[string]interface{}{
				"configMap": map[string]interface{}{
					"name": cmName,
					"file": cmFile,
				},
			},
			"runner":    runnerSpec,
			"arguments": argsText,
		},
		"status": map[string]interface{}{
			"stage":     stage,
			"active":    !suspended,
			"suspended": suspended,
		},
	}
}

func (s *Server) handleGetConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"name":"` + name + `","data":{"test.js":"// mock script content"}}`))
		return
	}

	cm, err := client.Clientset.CoreV1().ConfigMaps(namespace).Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name": cm.Name,
		"data": cm.Data,
	})
}

func (s *Server) handleUpdateConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var body struct {
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	cmClient := client.Clientset.CoreV1().ConfigMaps(namespace)
	cm, err := cmClient.Get(r.Context(), name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to find ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if cm.Data == nil {
		cm.Data = make(map[string]string)
	}
	for k, v := range body.Data {
		cm.Data[k] = v
	}

	_, err = cmClient.Update(r.Context(), cm, metav1.UpdateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListConfigMaps(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		w.Write([]byte(`[
			{
				"name": "mock-k6-script-1",
				"data": {
					"script.js": "import http from 'k6/http';\nimport { sleep } from 'k6';\n\nexport default function () {\n  http.get('https://test-api.k6.io');\n  sleep(1);\n}"
				}
			},
			{
				"name": "mock-k6-script-2",
				"data": {
					"main.js": "import http from 'k6/http';\nimport { check } from 'k6';\n\nexport default function () {\n  const res = http.get('https://httpbin.org/get');\n  check(res, {\n    'status is 200': (r) => r.status === 200,\n  });\n}"
				}
			}
		]`))
		return
	}

	cms, err := client.Clientset.CoreV1().ConfigMaps(namespace).List(r.Context(), metav1.ListOptions{
		LabelSelector: "k6s=enabled",
	})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list ConfigMaps: %v"}`, err), http.StatusInternalServerError)
		return
	}

	type CMItem struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Data      map[string]string `json:"data"`
	}
	result := make([]CMItem, 0)
	for _, cm := range cms.Items {
		result = append(result, CMItem{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Data:      cm.Data,
		})
	}

	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleDeleteConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	err = client.Clientset.CoreV1().ConfigMaps(namespace).Delete(r.Context(), name, metav1.DeleteOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleCreateConfigMap(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	var body struct {
		Name          string `json:"name"`
		FileName      string `json:"fileName"`
		ScriptContent string `json:"scriptContent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.FileName == "" {
		http.Error(w, `{"error":"name and fileName are required"}`, http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"name":"` + body.Name + `","data":{"` + body.FileName + `":"` + body.ScriptContent + `"}}`))
		return
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      body.Name,
			Namespace: namespace,
			Labels: map[string]string{
				"k6s": "enabled",
			},
		},
		Data: map[string]string{
			body.FileName: body.ScriptContent,
		},
	}

	created, err := client.Clientset.CoreV1().ConfigMaps(namespace).Create(r.Context(), cm, metav1.CreateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create ConfigMap: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name": created.Name,
		"data": created.Data,
	})
}

func (s *Server) getMockK6CRDs(namespace string) []map[string]interface{} {
	ns := namespace
	if ns == "" {
		ns = "default"
	}
	return []map[string]interface{}{
		{
			"apiVersion": "k6.io/v1alpha1",
			"kind":       "K6",
			"metadata": map[string]interface{}{
				"name":              "k6-api-loadtest",
				"namespace":         ns,
				"creationTimestamp": time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
			},
			"spec": map[string]interface{}{
				"parallelism": 3,
				"script": map[string]interface{}{
					"configMap": map[string]interface{}{
						"name": "k6-test-script",
						"file": "test.js",
					},
				},
				"runner": map[string]interface{}{
					"resources": map[string]interface{}{
						"limits": map[string]interface{}{
							"cpu":    "1000m",
							"memory": "1Gi",
						},
					},
				},
			},
			"status": map[string]interface{}{
				"stage": "running",
			},
		},
		{
			"apiVersion": "k6.io/v1alpha1",
			"kind":       "K6",
			"metadata": map[string]interface{}{
				"name":              "k6-spike-db-test",
				"namespace":         ns,
				"creationTimestamp": time.Now().Add(-5 * time.Hour).Format(time.RFC3339),
			},
			"spec": map[string]interface{}{
				"parallelism": 10,
				"script": map[string]interface{}{
					"configMap": map[string]interface{}{
						"name": "k6-db-spike-script",
						"file": "spike.js",
					},
				},
			},
			"status": map[string]interface{}{
				"stage": "finished",
			},
		},
	}
}

func (s *Server) queryKubernetesVersion(clusterID string) string {
	return s.k8sVersionCache.getOrCompute(clusterID, func() string {
		return s.queryKubernetesVersionUncached(clusterID)
	})
}

func (s *Server) queryKubernetesVersionUncached(clusterID string) string {
	client, _, err := s.getClusterClient(clusterID)
	if err != nil {
		return "v1.35.0-eks"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	var versionStr string
	done := make(chan struct{})
	go func() {
		info, err := client.Clientset.Discovery().ServerVersion()
		if err == nil && info != nil {
			versionStr = info.GitVersion
		}
		close(done)
	}()

	select {
	case <-done:
		if versionStr != "" {
			return versionStr
		}
	case <-ctx.Done():
	}

	return "v1.35.0-eks"
}

func (s *Server) checkK6OperatorWithClient(client *k8s.EKSClusterClient, namespaces []string) bool {
	// 1. Try Discovery API first with a larger timeout (5 seconds)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	type discoveryResult struct {
		resources *metav1.APIResourceList
		err       error
	}
	done := make(chan discoveryResult, 1)
	go func() {
		res, err := client.Clientset.Discovery().ServerResourcesForGroupVersion("k6.io/v1alpha1")
		done <- discoveryResult{resources: res, err: err}
	}()

	var res *metav1.APIResourceList
	var discErr error
	select {
	case r := <-done:
		res = r.resources
		discErr = r.err
	case <-ctx.Done():
		discErr = ctx.Err()
	}

	if res != nil && len(res.APIResources) > 0 {
		return true
	}
	if discErr == nil && res != nil {
		return true
	}

	// 2. Fallback to Dynamic client List checks in the specified namespaces
	// If the group is registered, dynamic list will return either success (nil error) or Forbidden error.
	// If the CRD is not registered, it will return a NotFound or "no matches for kind" error.
	for _, ns := range namespaces {
		dynamicCtx, dynamicCancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, err1 := client.DynamicClient.Resource(k8s.GetK6TestRunGVR()).Namespace(ns).List(dynamicCtx, metav1.ListOptions{})
		dynamicCancel()

		if err1 == nil {
			return true
		}

		err1Str := err1.Error()
		if !apierrors.IsNotFound(err1) &&
			!strings.Contains(err1Str, "could not find the requested resource") &&
			!strings.Contains(err1Str, "no matches for kind") {
			return true
		}

		dynamicCtx2, dynamicCancel2 := context.WithTimeout(context.Background(), 3*time.Second)
		_, err2 := client.DynamicClient.Resource(k8s.GetK6GVR()).Namespace(ns).List(dynamicCtx2, metav1.ListOptions{})
		dynamicCancel2()

		if err2 == nil {
			return true
		}

		err2Str := err2.Error()
		if !apierrors.IsNotFound(err2) &&
			!strings.Contains(err2Str, "could not find the requested resource") &&
			!strings.Contains(err2Str, "no matches for kind") {
			return true
		}
	}

	return false
}

func (s *Server) checkK6OperatorInstalled(clusterID string) bool {
	return s.operatorCache.getOrCompute(clusterID, func() bool {
		return s.checkK6OperatorInstalledUncached(clusterID)
	})
}

func (s *Server) checkK6OperatorInstalledUncached(clusterID string) bool {
	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		return false
	}
	if isMock {
		return true
	}

	var namespaces []string
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == clusterID {
					if c.Namespaces != "" {
						parts := strings.Split(c.Namespaces, ",")
						for _, p := range parts {
							t := strings.TrimSpace(p)
							if t != "" {
								namespaces = append(namespaces, t)
							}
						}
					}
					break
				}
			}
		}
	}
	namespaces = append(namespaces, "k6s", "default")

	return s.checkK6OperatorWithClient(client, namespaces)
}

func isAmazonEKSAPIEndpoint(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return strings.HasSuffix(host, ".eks.amazonaws.com") ||
		strings.HasSuffix(host, ".api.aws") ||
		strings.HasSuffix(host, ".amazonwebservices.com.cn")
}

func namespaceLabelSelector(clusterConfig *ClusterConfig) string {
	if clusterConfig != nil && isAmazonEKSAPIEndpoint(clusterConfig.APIServerURL) {
		// A key-only selector accepts every namespace carrying the k6s label,
		// independently of its value (for example enabled, true or team name).
		return "k6s"
	}
	return "k6s=enabled"
}

func (s *Server) handleListNamespaces(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	// If this cluster has static allowed namespaces defined, return them directly
	var clusterConfig *ClusterConfig
	if s.db != nil {
		clusters, err := s.db.GetClusters()
		if err == nil {
			for _, c := range clusters {
				if c.ID == id {
					clusterConfig = c
					break
				}
			}
		}
	}

	isEKS := clusterConfig != nil && isAmazonEKSAPIEndpoint(clusterConfig.APIServerURL)
	if !isEKS && clusterConfig != nil && clusterConfig.Namespaces != "" {
		parts := strings.Split(clusterConfig.Namespaces, ",")
		var cleaned []string
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				cleaned = append(cleaned, trimmed)
			}
		}
		if len(cleaned) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(cleaned)
			return
		}
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if isMock {
		json.NewEncoder(w).Encode([]string{"default", "k6-test", "testing"})
		return
	}

	nsList, err := client.Clientset.CoreV1().Namespaces().List(r.Context(), metav1.ListOptions{
		LabelSelector: namespaceLabelSelector(clusterConfig),
	})
	if err != nil {
		if isEKS {
			// Never expose an unverified namespace on EKS when discovery fails.
			json.NewEncoder(w).Encode([]string{})
			return
		}
		json.NewEncoder(w).Encode([]string{"default"})
		return
	}

	names := make([]string, 0)
	for _, ns := range nsList.Items {
		names = append(names, ns.Name)
	}

	json.NewEncoder(w).Encode(names)
}

func (s *Server) handleGetOperatorStatus(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if len(clusters) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ready","accessible_count":0,"total_count":0}`))
		return
	}

	totalCount := len(clusters)
	accessibleCount := 0
	deployedCount := 0

	for _, c := range clusters {
		client, isMock, err := s.getClusterClient(c.ID)
		if err != nil {
			continue
		}

		if isMock {
			accessibleCount++
			deployedCount++
			continue
		}

		// Try to query discovery API server version as a basic connection test
		_, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
		_, connErr := client.Clientset.Discovery().ServerVersion()
		cancel()

		if connErr != nil {
			continue
		}

		accessibleCount++

		// Check if K6 Operator CRD group is registered
		var namespaces []string
		if c.Namespaces != "" {
			parts := strings.Split(c.Namespaces, ",")
			for _, p := range parts {
				t := strings.TrimSpace(p)
				if t != "" {
					namespaces = append(namespaces, t)
				}
			}
		}
		namespaces = append(namespaces, "k6s", "default")

		if s.checkK6OperatorWithClient(client, namespaces) {
			deployedCount++
		}
	}

	status := "ready"
	if accessibleCount == 0 {
		status = "unavailable" // Red: all not accessible
	} else if deployedCount < totalCount {
		status = "degraded" // Yellow: not all have k6s deployed (or some not accessible)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           status,
		"accessible_count": accessibleCount,
		"deployed_count":   deployedCount,
		"total_count":      totalCount,
	})
}

func (s *Server) handleGetActiveTests(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get clusters: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// Fan out across clusters concurrently instead of the previous
	// sequential loop — with dozens of registered clusters the serial
	// version could take several seconds per dashboard load.
	var mu sync.Mutex
	activeCount := 0
	firstActiveName := "None"
	recordActive := func(name string) {
		mu.Lock()
		defer mu.Unlock()
		activeCount++
		if firstActiveName == "None" && name != "" {
			firstActiveName = name
		}
	}

	var wg sync.WaitGroup
	for _, c := range clusters {
		wg.Add(1)
		go func(c *database.ClusterConfig) {
			defer wg.Done()

			client, isMock, err := s.getClusterClient(c.ID)
			if err != nil {
				return
			}

			namespaces := []string{"default"}
			if c.Namespaces != "" {
				parts := strings.Split(c.Namespaces, ",")
				var cleaned []string
				for _, p := range parts {
					t := strings.TrimSpace(p)
					if t != "" {
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
						status, ok := item["status"].(map[string]interface{})
						if !ok {
							continue
						}
						if stage, _ := status["stage"].(string); strings.ToLower(stage) == "running" {
							name := ""
							if metadata, ok := item["metadata"].(map[string]interface{}); ok {
								name, _ = metadata["name"].(string)
							}
							recordActive(name)
						}
					}
				}
				return
			}

			for _, ns := range namespaces {
				ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
				items, listErr := client.ListK6CustomResources(ctx, ns)
				cancel()
				if listErr != nil {
					continue
				}
				for _, item := range items {
					statusObj, found, _ := unstructured.NestedMap(item.Object, "status")
					if !found {
						continue
					}
					if stage, _ := statusObj["stage"].(string); strings.ToLower(stage) == "running" {
						recordActive(item.GetName())
					}
				}
			}
		}(c)
	}
	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active_count": activeCount,
		"first_active": firstActiveName,
	})
}

// Run Defaults: global defaults for output arguments, image, and env vars.
// Keys stored in the settings table:
//   run_default_output_args  (string, the --out ... argument line)
//   run_default_use_output   (bool string "true"/"false")
//   run_default_use_image    (bool string "true"/"false")
//   run_default_image_url    (string)
//   run_default_env_vars     (JSON array of { key, value })

func (s *Server) handleRelaunchCRD(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	}

	oldObj, err := client.GetK6CustomResource(r.Context(), namespace, name)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to fetch existing CRD: %v"}`, err), http.StatusInternalServerError)
		return
	}

	baseName := stripTestRunDateSuffix(oldObj.GetName())
	resourceName, displayName := buildTestRunNames(baseName, time.Now().UTC())
	annotations := oldObj.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	annotations["k6s/run-name"] = displayName

	newObj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": oldObj.GetAPIVersion(),
			"kind":       oldObj.GetKind(),
			"metadata": map[string]interface{}{
				"name":        resourceName,
				"namespace":   oldObj.GetNamespace(),
				"annotations": annotations,
			},
		},
	}
	if labels := oldObj.GetLabels(); labels != nil {
		newObj.SetLabels(labels)
	}
	if spec, ok := oldObj.Object["spec"]; ok {
		newObj.Object["spec"] = spec
	}

	created, err := client.CreateK6CustomResource(r.Context(), namespace, newObj)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to recreate CRD: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(created.Object)
}

func (s *Server) handleListPods(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "all" {
		namespace = ""
	} else if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		mockPods := []map[string]string{
			{"name": "k6-load-test-run-initializer-pq72k", "status": "Completed"},
			{"name": "k6-load-test-run-runner-ab12c", "status": "Running"},
			{"name": "k6-load-test-run-runner-xy89z", "status": "Running"},
			{"name": "k6-test-script-initializer-99fgh", "status": "Completed"},
			{"name": "k6-test-script-runner-zxcv8", "status": "Finished"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockPods)
		return
	}

	podList, err := client.Clientset.CoreV1().Pods(namespace).List(r.Context(), metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to list pods: %v"}`, err), http.StatusInternalServerError)
		return
	}

	var pods []map[string]string
	for _, pod := range podList.Items {
		pods = append(pods, map[string]string{
			"name":   pod.Name,
			"status": string(pod.Status.Phase),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pods)
}

func (s *Server) handleGetPodLogs(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	podName := r.PathValue("pod_name")
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	client, isMock, err := s.getClusterClient(clusterID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if isMock {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("Mock Log Line 1\nMock Log Line 2\nMock Log Line 3\n"))
		return
	}

	tailLines := int64(100)
	podLogOptions := &corev1.PodLogOptions{
		Follow:    r.URL.Query().Get("follow") == "true",
		TailLines: &tailLines,
	}

	req := client.Clientset.CoreV1().Pods(namespace).GetLogs(podName, podLogOptions)
	stream, err := req.Stream(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to stream logs: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Transfer-Encoding", "chunked")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	buf := make([]byte, 1024)
	for {
		n, err := stream.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			break
		}
	}
}
