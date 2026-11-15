package mcpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func testAPI(t *testing.T, handler func(*http.Request) (int, string)) *API {
	t.Helper()
	api, err := NewAPI("http://127.0.0.1:8080", "stratum_tok_test-only", "team-a")
	if err != nil {
		t.Fatal(err)
	}
	api.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer stratum_tok_test-only" || r.Header.Get("X-Workspace-ID") != "team-a" {
			t.Error("missing authorization or non-read request")
		}
		status, body := handler(r)
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
	})
	return api
}
func TestMCPProtocolReadOnlyAndAuthorization(t *testing.T) {
	api := testAPI(t, func(r *http.Request) (int, string) {
		switch r.URL.Path {
		case "/api/k8s/clusters":
			return 200, `[{"id":"c","name":"cluster"}]`
		case "/api/influx/status":
			return 200, `{"configured":false}`
		default:
			return 403, `{"error":"private credential should never leak"}`
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ct, st := mcp.NewInMemoryTransports()
	ss, err := NewServer(api).Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := client.Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	list, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Tools) != 5 {
		t.Fatalf("tools=%d", len(list.Tools))
	}
	for _, tool := range list.Tools {
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Fatal("non-read-only tool")
		}
	}
	result, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "list_tests", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("list: %v %+v", err, result)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), "telemetry_configured") {
		t.Fatal("missing unconfigured state")
	}
	for _, args := range []map[string]any{{"cluster_id": "hidden", "namespace": "qa", "run_id": "run"}, {"cluster_id": "../hidden", "namespace": "qa", "run_id": "run"}} {
		result, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "get_test_metrics", Arguments: args})
		if err != nil || !result.IsError {
			t.Fatal("unauthorized or invalid request accepted")
		}
		encoded, _ = json.Marshal(result)
		if strings.Contains(string(encoded), "private credential") {
			t.Fatal("upstream body leaked")
		}
	}
}
func TestMetricsAndComparisonAreBoundedAndHonest(t *testing.T) {
	calls := 0
	api := testAPI(t, func(r *http.Request) (int, string) {
		calls++
		q := r.URL.Query()
		if q.Get("read_only") != "true" || q.Get("cluster") != "c" || q.Get("namespace") != "qa" {
			t.Error("missing scoped read-only metrics")
		}
		if strings.Contains(r.URL.Path, "empty") {
			return 200, `[]`
		}
		return 200, `[{"timestamp":"2026-10-12T10:00:00Z","value":10},{"timestamp":"2026-10-12T10:00:05Z","value":30}]`
	})
	b := MetricsInput{ClusterID: "c", Namespace: "qa", RunID: "run", Start: "2026-10-12T10:00:00Z", Stop: "2026-10-12T10:01:00Z"}
	c := b
	c.RunID = "empty"
	result, err := api.compare(context.Background(), CompareInput{Baseline: b, Candidate: c})
	if err != nil {
		t.Fatal(err)
	}
	if result["comparable"] != false || result["p95_available"] != false {
		t.Fatal("fabricated comparison from missing data")
	}
	before := calls
	c.Namespace = "hidden"
	if _, err := api.compare(context.Background(), CompareInput{Baseline: b, Candidate: c}); err == nil || calls != before {
		t.Fatal("invalid comparison queried API")
	}
}
func TestLogsPaginationAndNoEnvironmentDisclosure(t *testing.T) {
	api := testAPI(t, func(r *http.Request) (int, string) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/logs"):
			if r.URL.Query().Get("follow") != "false" {
				t.Error("unbounded stream")
			}
			return 200, "12345héllo"
		case strings.HasSuffix(r.URL.Path, "/crds"):
			return 200, `[{"kind":"TestRun","metadata":{"name":"a","namespace":"qa"},"spec":{"env":{"PASSWORD":"secret"}}},{"kind":"TestRun","metadata":{"name":"b","namespace":"qa"}}]`
		case strings.HasSuffix(r.URL.Path, "/pods"):
			return 200, `[{"name":"runner-a","labels":{"k6_cr":"a"}}]`
		default:
			return 200, `[]`
		}
	})
	result, err := api.list(context.Background(), ListInput{ClusterID: "c", Namespace: "qa", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "secret") || result["next_offset"] != 1 {
		t.Fatal("unsafe or unpaginated list")
	}
	status, err := api.status(context.Background(), Target{ClusterID: "c", Namespace: "qa", Name: "a", Kind: "TestRun"})
	if err != nil {
		t.Fatal(err)
	}
	if len(status["pods"].([]string)) != 1 {
		t.Fatal("missing related pods")
	}
	logs, err := api.logs(context.Background(), LogsInput{ClusterID: "c", Namespace: "qa", PodName: "p", MaxChars: 5})
	if err != nil || logs["text"] != "héllo" || logs["truncated"] != true {
		t.Fatalf("logs: %v %v", logs, err)
	}
}
func TestRejectUnsafeURLsAndOversizeResponses(t *testing.T) {
	for _, base := range []string{"http://remote.test", "https://user:pass@remote.test", "https://remote.test/api", "file:///tmp/test"} {
		if _, err := NewAPI(base, "stratum_tok_test", "default"); err == nil {
			t.Errorf("accepted %s", base)
		}
	}
	api := testAPI(t, func(*http.Request) (int, string) { return 200, strings.Repeat("x", maxResponseBytes+1) })
	if _, err := api.get(context.Background(), "/api/influx/status", nil, nil); err == nil {
		t.Fatal("oversized response accepted")
	}
}
