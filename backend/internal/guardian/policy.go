package guardian

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// protectedNamespaces can never be targeted by a portal-launched test or
// schedule, regardless of role or LLM opinion.
var protectedNamespaces = map[string]bool{
	"kube-system":     true,
	"kube-public":     true,
	"kube-node-lease": true,
}

// secretPatterns are cheap, high-confidence heuristics for credential
// material accidentally left in a k6 script. Not exhaustive — this is a
// defense-in-depth tripwire, not a secret scanner.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`AKIA[0-9A-Z]{16}`),                   // AWS access key id
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`), // PEM private key
	regexp.MustCompile(`(?i)aws_secret_access_key\s*[:=]`),
	regexp.MustCompile(`(?i)(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{4,}['"]`),
}

// EvaluatePolicy runs every deterministic, unbypassable hard-block check
// for the given subject. These checks never call the LLM and always run
// first, before any specialist agent, per the Guardian design principle
// that the model is advisory only.
func EvaluatePolicy(subject Subject) []Finding {
	var findings []Finding

	if subject.Namespace != "" && protectedNamespaces[strings.ToLower(strings.TrimSpace(subject.Namespace))] {
		findings = append(findings, Finding{
			Agent:        PolicyEngineName,
			Severity:     SeverityBlock,
			Category:     "protected_namespace",
			Message:      fmt.Sprintf("Namespace %q is a protected system namespace and cannot be targeted by portal-managed workloads.", subject.Namespace),
			SuggestedFix: "Choose a non-system namespace for this test or schedule.",
		})
	}

	switch subject.Type {
	case SubjectTestLaunch, SubjectScheduleNew:
		findings = append(findings, evaluateTestDefinitionPolicy(subject)...)
	case SubjectRBACChange, SubjectTokenGrant:
		findings = append(findings, evaluateAccessPolicy(subject)...)
	}

	return findings
}

func evaluateTestDefinitionPolicy(subject Subject) []Finding {
	var findings []Finding

	scriptContent, _ := subject.Payload["scriptContent"].(string)
	if scriptContent == "" {
		scriptContent, _ = subject.Payload["script_content"].(string)
	}
	if scriptContent != "" {
		for _, pattern := range secretPatterns {
			if pattern.MatchString(scriptContent) {
				findings = append(findings, Finding{
					Agent:        PolicyEngineName,
					Severity:     SeverityBlock,
					Category:     "secret_in_script",
					Message:      "The k6 script appears to contain hardcoded credential material (AWS keys, private keys, or a literal password).",
					SuggestedFix: "Remove the secret from the script and reference it via a Kubernetes Secret or environment variable injected at runtime instead.",
				})
				break
			}
		}
	}

	cpuLimit, _ := subject.Payload["cpuLimit"].(string)
	if cpuLimit == "" {
		cpuLimit, _ = subject.Payload["cpu_limit"].(string)
	}
	if cores := parseCPUCores(cpuLimit); cores > 0 {
		if strings.EqualFold(subject.Environment, "prod") && cores > 4 {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityBlock,
				Category:     "resource_ceiling",
				Message:      fmt.Sprintf("Requested CPU limit (%s) exceeds the 4-core-per-runner ceiling for production clusters.", cpuLimit),
				SuggestedFix: "Reduce the CPU limit or run this test against a non-production cluster first.",
			})
		} else if cores > 8 {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityBlock,
				Category:     "resource_ceiling",
				Message:      fmt.Sprintf("Requested CPU limit (%s) exceeds the platform-wide 8-core-per-runner ceiling.", cpuLimit),
				SuggestedFix: "Reduce the CPU limit, or contact a platform administrator to raise the tenant ceiling via guardian_policies.",
			})
		}
	}

	if parallelism, ok := parseInt(subject.Payload["parallelism"]); ok {
		if strings.EqualFold(subject.Environment, "prod") && parallelism > 20 {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityWarn,
				Category:     "blast_radius",
				Message:      fmt.Sprintf("Parallelism of %d runners against a production cluster has a large blast radius.", parallelism),
				SuggestedFix: "Confirm the target service can absorb this load, or stage the ramp-up with a lower parallelism first.",
			})
		}
	}

	return findings
}

func evaluateAccessPolicy(subject Subject) []Finding {
	var findings []Finding

	scopes := extractStringList(subject.Payload["scopes"])
	role, _ := subject.Payload["role"].(string)
	name, _ := subject.Payload["name"].(string)

	hasAdminFull := false
	for _, sc := range scopes {
		if strings.TrimSpace(sc) == "admin:full" {
			hasAdminFull = true
		}
	}
	if strings.EqualFold(role, "administrator") || strings.EqualFold(role, "admin") {
		hasAdminFull = true
	}

	looksLikeMachineToken := subject.Type == SubjectTokenGrant && looksAutomated(name)

	if hasAdminFull && subject.Type == SubjectTokenGrant {
		if looksLikeMachineToken {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityBlock,
				Category:     "least_privilege",
				Message:      fmt.Sprintf("Token %q looks like a CI/service token but requests admin:full — this violates least privilege for machine identities.", name),
				SuggestedFix: "Grant only the specific scopes the automation needs (e.g. tests:launch, logs:read) instead of admin:full.",
			})
		} else {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityWarn,
				Category:     "least_privilege",
				Message:      fmt.Sprintf("Token %q requests full administrator scope.", name),
				SuggestedFix: "Confirm this token truly needs admin:full rather than a narrower scope set.",
			})
		}
	}

	if subject.Type == SubjectRBACChange {
		targetUser, _ := subject.Payload["target_username"].(string)
		if targetUser != "" && strings.EqualFold(targetUser, subject.RequestedBy) && strings.EqualFold(role, "administrator") {
			findings = append(findings, Finding{
				Agent:        PolicyEngineName,
				Severity:     SeverityBlock,
				Category:     "separation_of_duty",
				Message:      fmt.Sprintf("%s is attempting to grant themselves the administrator role, which violates separation of duty.", subject.RequestedBy),
				SuggestedFix: "Have a different administrator approve and apply this role change.",
			})
		}
	}

	return findings
}

func looksAutomated(name string) bool {
	lower := strings.ToLower(name)
	for _, kw := range []string{"ci", "cd", "bot", "service", "machine", "automation", "pipeline", "github-actions", "gitlab"} {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func extractStringList(v interface{}) []string {
	switch val := v.(type) {
	case []string:
		return val
	case []interface{}:
		out := make([]string, 0, len(val))
		for _, item := range val {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		if val == "" {
			return nil
		}
		return strings.Split(val, ",")
	}
	return nil
}

func parseInt(v interface{}) (int, bool) {
	switch val := v.(type) {
	case int:
		return val, true
	case int32:
		return int(val), true
	case int64:
		return int(val), true
	case float64:
		return int(val), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(val))
		if err != nil {
			return 0, false
		}
		return n, true
	}
	return 0, false
}

var cpuCoreRegex = regexp.MustCompile(`^(\d+(?:\.\d+)?)m?$`)

// parseCPUCores parses a Kubernetes CPU quantity ("500m", "2", "4.5")
// into whole/fractional cores. Returns 0 if it cannot be parsed.
func parseCPUCores(cpu string) float64 {
	cpu = strings.TrimSpace(cpu)
	if cpu == "" {
		return 0
	}
	match := cpuCoreRegex.FindStringSubmatch(cpu)
	if match == nil {
		return 0
	}
	val, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0
	}
	if strings.HasSuffix(cpu, "m") {
		return val / 1000.0
	}
	return val
}
