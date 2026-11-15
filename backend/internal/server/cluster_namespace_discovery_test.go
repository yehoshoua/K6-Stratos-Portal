package server

import (
	"errors"
	"net/http/httptest"
	"testing"

	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestNamespaceDiscoveryLabelsScopesAndErrors(t *testing.T) {
	s, cleanup := setupTestServer(t)
	defer cleanup()
	c := &database.ClusterConfig{ID: "discovery", Name: "test", APIServerURL: addonTestEndpoint, WorkspaceID: "default"}
	if err := s.db.SaveCluster(c); err != nil {
		t.Fatal(err)
	}
	client := kubefake.NewClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "canonical", Labels: map[string]string{"k6s": "enabled"}}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "legacy", Labels: map[string]string{"ks6": "enabled"}}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "both", Labels: map[string]string{"k6s": "enabled", "ks6": "enabled"}}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "disabled", Labels: map[string]string{"ks6": "disabled"}}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "unlabelled"}},
	)
	s.clientCache["discovery"] = &k8s.EKSClusterClient{Clientset: client}
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/k8s/clusters/discovery/namespaces", nil)
		r.SetPathValue("id", "discovery")
		r.Header.Set("X-User-Role", "administrator")
		w := httptest.NewRecorder()
		s.handleListNamespaces(w, r)
		return w
	}
	w := request()
	if w.Code != 200 || w.Body.String() != "[\"both\",\"canonical\",\"legacy\"]\n" {
		t.Fatalf("discovery: %d %s", w.Code, w.Body.String())
	}
	c.Namespaces = "legacy"
	if err := s.db.SaveCluster(c); err != nil {
		t.Fatal(err)
	}
	w = request()
	if w.Code != 200 || w.Body.String() != "[\"legacy\"]\n" {
		t.Fatalf("allowlist ignored: %d %s", w.Code, w.Body.String())
	}
	client.PrependReactor("list", "namespaces", func(ktesting.Action) (bool, runtime.Object, error) { return true, nil, errors.New("forbidden") })
	w = request()
	if w.Code != 502 {
		t.Fatalf("failure hidden as empty success: %d %s", w.Code, w.Body.String())
	}
}
