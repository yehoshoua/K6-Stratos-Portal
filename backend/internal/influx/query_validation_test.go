package influx

import "testing"

func TestMetricQueryValidation(t *testing.T) {
	for _, tc := range []struct {
		run, metric, duration, start, stop, cluster, namespace string
		valid                                                  bool
	}{
		{run: "load-test", metric: "http_req_duration", duration: "1h", cluster: "eks-prod", namespace: "qa", valid: true},
		{run: `x' OR true`, metric: "vus", duration: "1h"},
		{run: `${r.test_run_id}`, metric: "vus", duration: "1h"},
		{run: `x\" |> yield()`, metric: "vus", duration: "1h"},
		{run: "x", metric: `vus\"`, duration: "1h"},
		{run: "x", metric: "vus", duration: "1h) |> yield()"},
		{run: "x", metric: "vus", duration: "99999d"},
		{run: "x", metric: "vus", duration: "31d", valid: true},
		{run: "x", metric: "vus", start: "2026-10-12T08:00:00Z", stop: "2026-10-12T09:00:00Z", valid: true},
		{run: "x", metric: "vus", start: "2026-10-12T10:00:00Z", stop: "2026-10-12T09:00:00Z"},
	} {
		if err := validateMetricQuery(tc.run, tc.metric, tc.duration, tc.start, tc.stop, tc.cluster, tc.namespace); (err == nil) != tc.valid {
			t.Errorf("%+v err=%v", tc, err)
		}
	}
}
