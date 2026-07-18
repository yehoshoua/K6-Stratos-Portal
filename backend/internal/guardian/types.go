// Package guardian implements the K6 Stratos "Guardian" multi-agent
// validation runtime: a deterministic policy engine plus a set of
// concurrent, LLM-backed specialist agents that review test launches,
// schedule creation, RBAC changes, and token grants before they take
// effect.
//
// Design principle (see docs/architecture_design.md and the Guardian
// plan): the LLM is always advisory. A deterministic, unbypassable policy
// check runs first and can never be downgraded or silently skipped by an
// agent. Agents can only add additional findings for human review.
package guardian

import "context"

// Severity of a single finding.
type Severity string

const (
	SeverityInfo  Severity = "info"
	SeverityWarn  Severity = "warn"
	SeverityBlock Severity = "block"
)

// Verdict is the overall, merged outcome of a validation run.
type Verdict string

const (
	VerdictPass  Verdict = "pass"
	VerdictWarn  Verdict = "warn"
	VerdictBlock Verdict = "block"
)

// Subject types Guardian knows how to evaluate. Kept as plain strings
// (mirrored in the database package) so they serialize cleanly.
const (
	SubjectTestLaunch  = "test_launch"
	SubjectScheduleNew = "schedule_create"
	SubjectRBACChange  = "rbac_change"
	SubjectTokenGrant  = "token_grant"
)

// PolicyEngineName identifies findings produced by the deterministic
// engine (as opposed to an LLM specialist agent) so callers can tell hard,
// unbypassable blocks apart from AI-advisory ones.
const PolicyEngineName = "policy-engine"

// Finding is one opinion — from either the deterministic policy engine or
// an LLM specialist agent — attached to a validation run.
type Finding struct {
	Agent        string   `json:"agent"`
	Severity     Severity `json:"severity"`
	Category     string   `json:"category"`
	Message      string   `json:"message"`
	SuggestedFix string   `json:"suggested_fix,omitempty"`
	Raw          string   `json:"raw,omitempty"`
}

// IsHardBlock reports whether this finding came from the deterministic
// policy engine (unbypassable without an explicit, audited admin
// override) rather than from an advisory LLM agent.
func (f Finding) IsHardBlock() bool {
	return f.Agent == PolicyEngineName && f.Severity == SeverityBlock
}

// Subject describes the thing being validated: a test launch, a schedule
// creation, an RBAC/role change, or an API token grant.
type Subject struct {
	Type        string
	Ref         string
	RequestedBy string
	ClusterID   string
	Namespace   string
	Environment string
	Payload     map[string]interface{}
}

// Report is the merged outcome of every finding produced for a Subject.
type Report struct {
	Verdict  Verdict   `json:"verdict"`
	Score    int       `json:"score"`
	Findings []Finding `json:"findings"`
}

// ModelInvoker abstracts the underlying LLM backend so the coordinator
// and agents can be unit tested without a live Bedrock connection, and so
// the platform can add other model providers later without touching
// agent logic.
type ModelInvoker interface {
	Invoke(ctx context.Context, systemPrompt, userPrompt string) (string, error)
}

// Agent is a specialist LLM reviewer.
type Agent interface {
	Name() string
	Applies(subject Subject) bool
	Run(ctx context.Context, invoker ModelInvoker, subject Subject) (Finding, error)
}
