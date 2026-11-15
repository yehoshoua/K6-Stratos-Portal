package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"k6-bedrock-dashboard/backend/internal/auth"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/guardian"
	"k6-bedrock-dashboard/backend/internal/influx"
	"k6-bedrock-dashboard/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
)

func securityServer(t *testing.T) (*Server, *http.ServeMux) {
	t.Helper()
	s, cleanup := setupTestServer(t)
	t.Cleanup(cleanup)
	for _, name := range []string{"admin", "editor", "viewer", "outsider"} {
		role := name
		if name == "admin" {
			role = "administrator"
		}
		if name == "outsider" {
			role = "editor"
		}
		hash, err := auth.HashPassword("test-password-only")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.db.SaveUser(&database.User{Username: name, Role: role, PasswordHash: hash, CreatedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
		if name != "outsider" {
			if err := s.db.SaveWorkspaceUser(&database.WorkspaceUser{WorkspaceID: "default", Username: name, Role: role}); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, c := range []*database.ClusterConfig{
		{ID: "allowed", Name: "allowed", APIServerURL: "mock", AuthType: "mock", WorkspaceID: "default", Namespaces: "qa,staging", CreatedAt: time.Now()},
		{ID: "hidden", Name: "hidden", APIServerURL: "mock", AuthType: "mock", WorkspaceID: "other", CreatedAt: time.Now()},
	} {
		if err := s.db.SaveCluster(c); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	return s, mux
}
func sessionFor(t *testing.T, s *Server, user string) string {
	t.Helper()
	u, err := s.db.GetUser(user)
	if err != nil || u == nil {
		t.Fatal("missing user")
	}
	token, err := s.authSvc.GenerateToken(user, u.Role)
	if err != nil {
		t.Fatal(err)
	}
	return token
}
func securityRequest(mux http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}
func TestSecurityAnonymousSSODisabledAndSecretsRedacted(t *testing.T) {
	s, mux := securityServer(t)
	w := securityRequest(mux, "POST", "/api/auth/sso", "", `{"user":"admin"}`)
	if w.Code == 200 || len(w.Result().Cookies()) > 0 {
		t.Fatal("anonymous session issued")
	}
	if err := s.db.SaveInfluxConfig(&database.InfluxConfig{ID: "test", Name: "test", Token: "dummy-sensitive-token", Password: "dummy-sensitive-password", CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	w = securityRequest(mux, "GET", "/api/settings/influxdb/servers", sessionFor(t, s, "viewer"), "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "dummy-sensitive") || !strings.Contains(w.Body.String(), `"has_token":true`) {
		t.Fatalf("unsafe response: %d %s", w.Code, w.Body.String())
	}
	w = securityRequest(mux, "POST", "/api/settings/influxdb/servers/test/activate", sessionFor(t, s, "viewer"), "")
	if w.Code != 403 {
		t.Fatalf("viewer activation: %d", w.Code)
	}
}
func TestSecurityClusterWorkspaceAndNamespaceAccess(t *testing.T) {
	s, mux := securityServer(t)
	for _, tc := range []struct {
		user, path string
		want       int
	}{
		{"editor", "/api/k8s/clusters/allowed/crds?namespace=qa", 200},
		{"editor", "/api/k8s/clusters/hidden/crds?namespace=qa", 403},
		{"editor", "/api/k8s/clusters/allowed/crds?namespace=kube-system", 403},
		{"outsider", "/api/k8s/clusters/allowed/crds?namespace=qa", 403},
	} {
		t.Run(tc.user+tc.path, func(t *testing.T) {
			w := securityRequest(mux, "GET", tc.path, sessionFor(t, s, tc.user), "")
			if w.Code != tc.want {
				t.Fatalf("status=%d want %d", w.Code, tc.want)
			}
		})
	}
	if err := s.db.SaveUserScope(&database.UserScope{Username: "editor", ClusterID: "hidden"}); err != nil {
		t.Fatal(err)
	}
	w := securityRequest(mux, "GET", "/api/k8s/clusters/allowed/crds?namespace=qa", sessionFor(t, s, "editor"), "")
	if w.Code != 403 {
		t.Fatal("ABAC bypass")
	}
}
func TestSecurityAllNamespacesUsesOnlyAllowedNamespaces(t *testing.T) {
	s, mux := securityServer(t)
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{k8s.GetK6TestRunGVR(): "TestRunList", k8s.GetK6GVR(): "K6List"})
	s.clientCache["allowed"] = &k8s.EKSClusterClient{Clientset: kubefake.NewClientset(), DynamicClient: dyn}
	if err := s.db.SaveUserScope(&database.UserScope{Username: "viewer", ClusterID: "allowed", Namespace: "qa"}); err != nil {
		t.Fatal(err)
	}
	w := securityRequest(mux, "GET", "/api/k8s/clusters/allowed/crds?namespace=all", sessionFor(t, s, "viewer"), "")
	if w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	if len(dyn.Actions()) == 0 {
		t.Fatal("no list executed")
	}
	for _, action := range dyn.Actions() {
		if action.GetNamespace() != "qa" {
			t.Fatalf("unauthorized namespace %q", action.GetNamespace())
		}
	}
}
func TestSecurityTokenScopesAndOwnerRevocation(t *testing.T) {
	s, mux := securityServer(t)
	token := "stratum_tok_test-only"
	hash := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(hash[:])
	if err := s.db.SaveAPIToken(key, "ci", "editor", "tests:read", "editor", nil); err != nil {
		t.Fatal(err)
	}
	w := securityRequest(mux, "DELETE", "/api/k8s/clusters/allowed/crds/demo?namespace=qa", token, "")
	if w.Code != 403 {
		t.Fatalf("read token can write: %d", w.Code)
	}
	w = securityRequest(mux, "GET", "/api/k8s/clusters/allowed/crds?namespace=qa", token, "")
	if w.Code != 200 {
		t.Fatalf("read token cannot read: %d %s", w.Code, w.Body.String())
	}
	w = securityRequest(mux, "POST", "/api/v1/me/tokens", token, `{"name":"child","expiry_days":1}`)
	if w.Code != 403 {
		t.Fatal("token delegation permitted")
	}
	owner, _ := s.db.GetUser("editor")
	owner.Role = "viewer"
	if err := s.db.SaveUser(owner); err != nil {
		t.Fatal(err)
	}
	w = securityRequest(mux, "GET", "/api/auth/me", token, "")
	if w.Code != 401 {
		t.Fatal("personal token survived role change")
	}
}
func TestSecuritySessionsRevokedOnAccountChanges(t *testing.T) {
	for _, change := range []string{"role", "password", "delete"} {
		t.Run(change, func(t *testing.T) {
			s, mux := securityServer(t)
			token := sessionFor(t, s, "editor")
			u, _ := s.db.GetUser("editor")
			switch change {
			case "role":
				u.Role = "viewer"
			case "password":
				u.PasswordHash = "changed"
			case "delete":
				if err := s.db.DeleteUser("editor"); err != nil {
					t.Fatal(err)
				}
			}
			if change != "delete" {
				if err := s.db.SaveUser(u); err != nil {
					t.Fatal(err)
				}
			}
			if w := securityRequest(mux, "GET", "/api/auth/me", token, ""); w.Code != 401 {
				t.Fatalf("session survived %s", change)
			}
		})
	}
}
func TestSecurityGuardianBindsCompletedValidation(t *testing.T) {
	s, _ := securityServer(t)
	subject := guardian.Subject{Type: guardian.SubjectTestLaunch, Ref: "demo", RequestedBy: "editor", ClusterID: "allowed", Namespace: "qa", Payload: map[string]interface{}{"cpuLimit": "1"}}
	for _, tc := range []struct {
		name, verdict                                         string
		pending, expired, otherUser, otherPayload, overridden bool
		want                                                  bool
	}{
		{name: "valid", verdict: "pass", want: true}, {name: "warning", verdict: "warn", want: true},
		{name: "pending", verdict: "pending", pending: true}, {name: "expired", verdict: "pass", expired: true},
		{name: "other-user", verdict: "pass", otherUser: true}, {name: "changed-payload", verdict: "pass", otherPayload: true},
		{name: "blocked", verdict: "block"}, {name: "advisory-override", verdict: "block", overridden: true, want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload, _ := json.Marshal(subject.Payload)
			now := time.Now()
			completed := &now
			if tc.pending {
				completed = nil
			}
			created := now
			if tc.expired {
				created = now.Add(-11 * time.Minute)
			}
			actor := subject.RequestedBy
			if tc.otherUser {
				actor = "viewer"
			}
			if tc.otherPayload {
				payload = []byte(`{"cpuLimit":"2"}`)
			}
			run := &database.ValidationRun{ID: tc.name, SubjectType: subject.Type, SubjectRef: subject.Ref, RequestedBy: actor, ClusterID: subject.ClusterID, Namespace: subject.Namespace, PayloadJSON: string(payload), OverallVerdict: tc.verdict, CreatedAt: created, CompletedAt: completed, Overridden: tc.overridden}
			if err := s.db.CreateValidationRun(run); err != nil {
				t.Fatal(err)
			}
			err := s.guardianGate(context.Background(), httptest.NewRequest("POST", "/", nil), subject, tc.name)
			if (err == nil) != tc.want {
				t.Fatalf("err=%v want allow=%v", err, tc.want)
			}
		})
	}
	subject.Namespace = "kube-system"
	if err := s.guardianGate(context.Background(), nil, subject, "advisory-override"); err == nil {
		t.Fatal("hard policy bypass")
	}
	s.guardianCoordinator = nil
	if err := s.guardianGate(context.Background(), nil, subject, ""); err == nil {
		t.Fatal("disabled AI bypasses policy")
	}
}
func TestSecurityReferencedScriptIsValidated(t *testing.T) {
	s, _ := securityServer(t)
	kube := kubefake.NewClientset(&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "script", Namespace: "qa"}, Data: map[string]string{"script.js": `const password = "secret-value";`}})
	s.clientCache["allowed"] = &k8s.EKSClusterClient{Clientset: kube}
	subject, err := s.workloadSubject(context.Background(), "allowed", "qa", workloadRequest{Name: "demo", Spec: map[string]interface{}{"script": map[string]interface{}{"configMap": map[string]interface{}{"name": "script", "file": "script.js"}}}}, "editor")
	if err != nil {
		t.Fatal(err)
	}
	if deterministicGuard(subject) == nil {
		t.Fatal("referenced secret ignored")
	}
}
func TestSecurityTemplateAndScheduleReferences(t *testing.T) {
	s, mux := securityServer(t)
	if err := s.db.SaveTemplate(&database.K6Template{ID: "hidden", Name: "hidden", TemplateType: "testrun", WorkspaceID: "other", CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	token := sessionFor(t, s, "editor")
	for _, method := range []string{"PUT", "DELETE"} {
		w := securityRequest(mux, method, "/api/settings/templates/hidden", token, `{}`)
		if w.Code != 403 {
			t.Fatalf("template %s returned %d", method, w.Code)
		}
	}
	body := `{"name":"demo","cluster_id":"allowed","namespace":"qa","template_id":"hidden","cron_expression":"0 * * * *"}`
	if w := securityRequest(mux, "POST", "/api/settings/schedules", token, body); w.Code != 403 {
		t.Fatalf("foreign template schedule: %d", w.Code)
	}
}
func TestSecurityWorkspacePathCannotEscape(t *testing.T) {
	s, mux := securityServer(t)
	for _, path := range []string{"/api/files?workspace_id=../../tmp", "/api/files?workspace_id=/tmp"} {
		w := securityRequest(mux, "GET", path, sessionFor(t, s, "admin"), "")
		if w.Code != 400 {
			t.Fatalf("path %s status %d", path, w.Code)
		}
	}
}
func TestSecurityPreflightAndLaunchUseSamePayload(t *testing.T) {
	s, mux := securityServer(t)
	token := sessionFor(t, s, "editor")
	workload := `{"name":"demo","resource_kind":"testrun","scriptContent":"export default function() {}","spec":{"parallelism":1,"runner":{"resources":{"limits":{"cpu":"1","memory":"512Mi"}}}}}`
	preflight := fmt.Sprintf(`{"subject_type":"test_launch","subject_ref":"demo","cluster_id":"allowed","namespace":"qa","payload":%s}`, workload)
	w := securityRequest(mux, "POST", "/api/v1/guardian/validate", token, preflight)
	if w.Code != 202 {
		t.Fatalf("preflight: %d %s", w.Code, w.Body.String())
	}
	var reply struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		run, err := s.db.GetValidationRun(reply.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run != nil && run.CompletedAt != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("validation never completed")
		}
		time.Sleep(time.Millisecond)
	}
	var body map[string]interface{}
	json.Unmarshal([]byte(workload), &body)
	body["validation_run_id"] = reply.ID
	encoded, _ := json.Marshal(body)
	w = securityRequest(mux, "POST", "/api/k8s/clusters/allowed/crds?namespace=qa", token, string(encoded))
	if w.Code >= 400 {
		t.Fatalf("launch: %d %s", w.Code, w.Body.String())
	}
	body["scriptContent"] = "modified"
	encoded, _ = json.Marshal(body)
	w = securityRequest(mux, "POST", "/api/k8s/clusters/allowed/crds?namespace=qa", token, string(encoded))
	if w.Code != 412 {
		t.Fatalf("changed payload accepted: %d", w.Code)
	}
}

func TestSecurityScheduleActionsAndServerAssignedID(t *testing.T) {
	s, mux := securityServer(t)
	tmpl := &database.K6Template{ID: "safe", Name: "safe", TemplateType: "testrun", WorkspaceID: "default", ScriptContent: "export default function() {}", CreatedAt: time.Now()}
	if err := s.db.SaveTemplate(tmpl); err != nil {
		t.Fatal(err)
	}
	original := &database.TestSchedule{Name: "existing", ClusterID: "allowed", Namespace: "qa", TemplateID: tmpl.ID, CreatedAt: time.Now(), CronExpression: "0 * * * *", Active: true}
	if err := s.db.SaveSchedule(original); err != nil {
		t.Fatal(err)
	}
	token := sessionFor(t, s, "editor")
	for _, action := range []string{"toggle", "run"} {
		w := securityRequest(mux, "POST", fmt.Sprintf("/api/settings/schedules/%d/%s", original.ID, action), token, "")
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", action, w.Code, w.Body.String())
		}
	}
	payload := fmt.Sprintf(`{"id":%d,"name":"new","cluster_id":"allowed","namespace":"qa","template_id":"safe","cron_expression":"0 * * * *","active":true}`, original.ID)
	w := securityRequest(mux, "POST", "/api/settings/schedules", token, payload)
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	existing, err := s.db.GetSchedule(original.ID)
	if err != nil || existing.Name != "existing" {
		t.Fatal("create payload overwrote existing schedule")
	}
	w = securityRequest(mux, "POST", "/api/settings/schedules", token, strings.Replace(payload, `"namespace":"qa"`, `"namespace":"all"`, 1))
	if w.Code != 403 {
		t.Fatalf("namespace=all accepted: %d", w.Code)
	}
}

func TestSecurityMetricsRequireAuthorizedTags(t *testing.T) {
	s, mux := securityServer(t)
	token := sessionFor(t, s, "viewer")
	for _, suffix := range []string{"", "?cluster=hidden&namespace=qa", "?cluster=allowed&namespace=kube-system", "?cluster=allowed&namespace=all"} {
		for _, action := range []string{"metrics", "stream"} {
			w := securityRequest(mux, "GET", "/api/influx/runs/test/"+action+suffix, token, "")
			if w.Code != 403 {
				t.Fatalf("unauthorized metrics: %s %s: %d", action, suffix, w.Code)
			}
		}
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-User-Name", "viewer")
	r.Header.Set("X-User-Role", "viewer")
	if !s.metricRunAllowed(r, influx.TestRunSummary{Cluster: "allowed", Namespace: "qa"}) {
		t.Fatal("authorized tags rejected")
	}
	if s.metricRunAllowed(r, influx.TestRunSummary{}) {
		t.Fatal("untagged data leaked")
	}
}

func TestSecurityMetricsRejectAmbiguousClusterNames(t *testing.T) {
	s, _ := securityServer(t)
	if err := s.db.SaveCluster(&database.ClusterConfig{ID: "collision", Name: "allowed", WorkspaceID: "other", CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-User-Name", "viewer")
	r.Header.Set("X-User-Role", "viewer")
	if s.metricRunAllowed(r, influx.TestRunSummary{Cluster: "allowed", Namespace: "qa"}) {
		t.Fatal("ambiguous tag authorizes a hidden cluster")
	}
}

func TestSecurityJobPreservesGuidedSecretAndRunIDReferences(t *testing.T) {
	s, mux := securityServer(t)
	kube := kubefake.NewClientset()
	s.clientCache["allowed"] = &k8s.EKSClusterClient{Clientset: kube}
	payload := `{"name":"guided-job","resource_kind":"job","scriptContent":"export default function () {}","spec":{"parallelism":1,"runner":{"image":"grafana/k6:latest","env":[{"name":"STRATOS_BEARER_TOKEN","valueFrom":{"secretKeyRef":{"name":"api-auth","key":"token"}}},{"name":"STRATOS_RUN_ID","valueFrom":{"fieldRef":{"fieldPath":"metadata.labels['job-name']"}}}]}}}`
	w := securityRequest(mux, "POST", "/api/k8s/clusters/allowed/crds?namespace=qa", sessionFor(t, s, "editor"), payload)
	if w.Code != 200 {
		t.Fatalf("create job: %d %s", w.Code, w.Body.String())
	}
	jobs, err := kube.BatchV1().Jobs("qa").List(context.Background(), metav1.ListOptions{})
	if err != nil || len(jobs.Items) != 1 {
		t.Fatal("missing created job")
	}
	env := jobs.Items[0].Spec.Template.Spec.Containers[0].Env
	if len(env) != 2 || env[0].ValueFrom == nil || env[0].ValueFrom.SecretKeyRef.Name != "api-auth" || env[0].Value != "" || env[1].ValueFrom == nil || env[1].ValueFrom.FieldRef == nil {
		t.Fatal("secret or field reference lost")
	}
}
