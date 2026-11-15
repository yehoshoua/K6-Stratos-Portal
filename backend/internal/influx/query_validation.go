package influx

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var metricNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
var metricRangePattern = regexp.MustCompile(`^[1-9][0-9]{0,4}(s|m|h|d)$`)

func validateMetricQuery(run, metric, duration, start, stop, cluster, namespace string) error {
	for _, value := range []string{run, cluster, namespace} {
		if len(value) > 512 || strings.Contains(value, "${") || strings.ContainsAny(value, "\"'\\\n\r\x00") {
			return fmt.Errorf("invalid metric filter")
		}
	}
	if !metricNamePattern.MatchString(metric) {
		return fmt.Errorf("invalid metric name")
	}
	if start != "" || stop != "" {
		from, err := time.Parse(time.RFC3339Nano, start)
		if err != nil {
			return fmt.Errorf("invalid start time")
		}
		to, err := time.Parse(time.RFC3339Nano, stop)
		if err != nil || !to.After(from) || to.Sub(from) > 31*24*time.Hour {
			return fmt.Errorf("invalid time range (maximum 31 days)")
		}
	} else {
		if !metricRangePattern.MatchString(duration) {
			return fmt.Errorf("invalid duration")
		}
		parsed := duration
		if strings.HasSuffix(parsed, "d") {
			parsed = strings.TrimSuffix(parsed, "d") + "h"
			d, err := time.ParseDuration(parsed)
			if err != nil || d > 31*time.Hour {
				return fmt.Errorf("range exceeds 31 days")
			}
		} else {
			d, err := time.ParseDuration(parsed)
			if err != nil || d > 31*24*time.Hour {
				return fmt.Errorf("range exceeds 31 days")
			}
		}
	}
	return nil
}
