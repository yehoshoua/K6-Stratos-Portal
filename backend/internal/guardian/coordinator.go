package guardian

import (
	"context"
	"fmt"
	"sync"
	"time"
)

const agentTimeout = 20 * time.Second

// Coordinator fans out to every applicable specialist agent concurrently
// (real multi-agent parallelism, not sequential prompting), always after
// the deterministic policy engine has run first.
type Coordinator struct {
	invoker ModelInvoker // nil => LLM agents are skipped; deterministic-only (fail open)
	agents  []Agent
}

// NewCoordinator builds a Coordinator. Pass a nil invoker to run in
// deterministic-only mode (e.g. Bedrock unreachable/unconfigured) — the
// platform must never be blocked from operating because the LLM is down.
func NewCoordinator(invoker ModelInvoker) *Coordinator {
	return &Coordinator{
		invoker: invoker,
		agents: []Agent{
			&TestDefinitionAgent{},
			&AccessControlAgent{},
			&DeploymentSafetyAgent{},
		},
	}
}

// Evaluate runs the full Guardian pipeline for a subject. onFinding, if
// non-nil, is invoked synchronously (from whichever goroutine produced
// it) as soon as each finding is available, so callers can stream
// progress over SSE without waiting for every agent to finish.
func (c *Coordinator) Evaluate(ctx context.Context, subject Subject, onFinding func(Finding)) Report {
	var findings []Finding

	// 1. Deterministic policy engine — always runs first, never skipped,
	// never gated behind LLM availability.
	for _, f := range EvaluatePolicy(subject) {
		findings = append(findings, f)
		if onFinding != nil {
			onFinding(f)
		}
	}

	// 2. Concurrent LLM specialist agents (advisory only).
	if c.invoker != nil {
		var mu sync.Mutex
		var wg sync.WaitGroup
		for _, agent := range c.agents {
			if !agent.Applies(subject) {
				continue
			}
			wg.Add(1)
			go func(a Agent) {
				defer wg.Done()
				agentCtx, cancel := context.WithTimeout(ctx, agentTimeout)
				defer cancel()

				finding, err := a.Run(agentCtx, c.invoker, subject)
				if err != nil {
					finding = Finding{
						Agent:    a.Name(),
						Severity: SeverityInfo,
						Category: "agent_unavailable",
						Message:  fmt.Sprintf("This advisory agent could not complete: %v. Deterministic checks were not affected.", err),
					}
				}

				mu.Lock()
				findings = append(findings, finding)
				mu.Unlock()
				if onFinding != nil {
					onFinding(finding)
				}
			}(agent)
		}
		wg.Wait()
	}

	return mergeVerdict(findings)
}

// mergeVerdict combines every finding into one overall verdict and a
// 0-100 confidence/risk score. A single deterministic block always wins;
// otherwise the highest severity across all findings (policy or agent)
// determines the verdict.
func mergeVerdict(findings []Finding) Report {
	verdict := VerdictPass
	score := 100

	for _, f := range findings {
		switch f.Severity {
		case SeverityBlock:
			verdict = VerdictBlock
			score -= 40
		case SeverityWarn:
			if verdict != VerdictBlock {
				verdict = VerdictWarn
			}
			score -= 15
		}
	}

	if score < 0 {
		score = 0
	}

	return Report{Verdict: verdict, Score: score, Findings: findings}
}

// HasUnbypassableBlock reports whether the report contains at least one
// deterministic policy-engine block, which requires an explicit,
// justified, audited admin override rather than a routine "acknowledge
// and proceed".
func (r Report) HasUnbypassableBlock() bool {
	for _, f := range r.Findings {
		if f.IsHardBlock() {
			return true
		}
	}
	return false
}
