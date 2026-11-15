package server

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/influx"
)

type metricsReadTransport func(*http.Request) (*http.Response, error)

func (f metricsReadTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestReadOnlyMetricsDoNotCreateSLAAlerts(t *testing.T) {
	s, mux := securityServer(t)
	old := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: metricsReadTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[{"series":[{"columns":["time","mean"],"values":[["2026-10-12T10:00:00Z",900]]}]}]}`)), Header: http.Header{}, Request: r}, nil
	})}
	defer func() { http.DefaultClient = old }()
	s.config.InfluxURL = "http://metrics.test"
	s.influxSvc = influx.NewMetricsService("v1", s.config.InfluxURL, "", "", "k6", "", "", "GET")
	if err := s.db.SaveTemplate(&database.K6Template{ID: "readonly", Name: "readonly", ScriptName: "readonly", WorkspaceID: "default", SLAThresholds: `[{"metric":"http_req_duration","operator":">","value":500}]`, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	token := sessionFor(t, s, "viewer")
	path := "/api/influx/runs/readonly/metrics?cluster=allowed&namespace=qa"
	response := securityRequest(mux, "GET", path+"&read_only=true", token, "")
	if response.Code != 200 || !strings.Contains(response.Body.String(), "900") {
		t.Fatalf("read-only query failed: %d %s", response.Code, response.Body.String())
	}
	// A normal read is a positive control: wait for its asynchronous alert write,
	// then ensure the read-only request did not produce an additional alert.
	response = securityRequest(mux, "GET", path, token, "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		alerts, err := s.db.GetAlerts()
		if err != nil {
			t.Fatal(err)
		}
		if len(alerts) > 1 {
			t.Fatal("read-only query created an SLA alert")
		}
		if len(alerts) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("positive-control alert missing")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
