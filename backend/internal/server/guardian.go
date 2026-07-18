package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/guardian"
)

// newGuardianCoordinator wires up the Guardian multi-agent runtime. If
// Bedrock is disabled or unreachable, it fails open to deterministic-only
// validation (nil invoker) rather than blocking server startup — the
// platform must keep operating even when the LLM backend is unavailable.
func newGuardianCoordinator(cfg *config.Config) *guardian.Coordinator {
	if !cfg.GuardianEnabled {
		log.Printf("guardian: disabled via GUARDIAN_ENABLED=false, running policy-engine only (no AI advisory agents)")
		return guardian.NewCoordinator(nil)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	invoker, err := guardian.NewBedrockInvoker(ctx, cfg.AWSRegion, cfg.BedrockModelID)
	if err != nil {
		log.Printf("guardian: Bedrock unavailable (%v) — falling back to deterministic-only validation", err)
		return guardian.NewCoordinator(nil)
	}
	log.Printf("guardian: Bedrock-backed multi-agent validation enabled (model=%s)", cfg.BedrockModelID)
	return guardian.NewCoordinator(invoker)
}

// --- SSE event bus for streaming per-agent verdicts as they land ---

type guardianEvent struct {
	Finding *guardian.Finding `json:"finding,omitempty"`
	Done    bool              `json:"done,omitempty"`
	Report  *guardian.Report  `json:"report,omitempty"`
}

type guardianEventBus struct {
	mu   sync.Mutex
	subs map[string][]chan guardianEvent
}

func newGuardianEventBus() *guardianEventBus {
	return &guardianEventBus{subs: make(map[string][]chan guardianEvent)}
}

func (b *guardianEventBus) subscribe(runID string) chan guardianEvent {
	ch := make(chan guardianEvent, 16)
	b.mu.Lock()
	b.subs[runID] = append(b.subs[runID], ch)
	b.mu.Unlock()
	return ch
}

func (b *guardianEventBus) unsubscribe(runID string, ch chan guardianEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	list := b.subs[runID]
	for i, c := range list {
		if c == ch {
			b.subs[runID] = append(list[:i], list[i+1:]...)
			break
		}
	}
}

func (b *guardianEventBus) publish(runID string, ev guardianEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range b.subs[runID] {
		select {
		case ch <- ev:
		default:
			// slow consumer: drop rather than block the validation goroutine
		}
	}
}

func (b *guardianEventBus) closeAndDelete(runID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range b.subs[runID] {
		close(ch)
	}
	delete(b.subs, runID)
}

// --- Core evaluation ---

// buildTestLaunchSubject turns a CRD-create payload (as accepted by
// handleCreateCRD) into a Guardian Subject, pulling CPU/memory/runner
// image out of the nested TestRun spec shape and resolving the target
// cluster's environment tag for production-safety checks.
func (s *Server) buildTestLaunchSubject(clusterID, namespace, name, scriptContent, cronExpression string, spec map[string]interface{}, requestedBy string) guardian.Subject {
	payload := map[string]interface{}{
		"name":          name,
		"scriptContent": scriptContent,
	}
	if cronExpression != "" {
		payload["cronExpression"] = cronExpression
	}
	if spec != nil {
		if p, ok := spec["parallelism"]; ok {
			payload["parallelism"] = p
		}
		if runner, ok := spec["runner"].(map[string]interface{}); ok {
			if image, ok := runner["image"]; ok {
				payload["runnerImage"] = image
			}
			if resources, ok := runner["resources"].(map[string]interface{}); ok {
				if limits, ok := resources["limits"].(map[string]interface{}); ok {
					if cpu, ok := limits["cpu"]; ok {
						payload["cpuLimit"] = cpu
					}
					if mem, ok := limits["memory"]; ok {
						payload["memLimit"] = mem
					}
				}
			}
		}
	}

	environment := ""
	if cfg := s.getClusterConfig(clusterID); cfg != nil {
		environment = normalizeEnvironment(cfg.Environment, cfg.Name)
	}

	subjectType := guardian.SubjectTestLaunch
	if cronExpression != "" {
		subjectType = guardian.SubjectScheduleNew
	}

	return guardian.Subject{
		Type:        subjectType,
		Ref:         name,
		RequestedBy: requestedBy,
		ClusterID:   clusterID,
		Namespace:   namespace,
		Environment: environment,
		Payload:     payload,
	}
}

// buildScheduleSubject turns a schedule-create request into a Guardian
// Subject, pulling script content and resource limits from the
// referenced template.
func (s *Server) buildScheduleSubject(sched *database.TestSchedule, requestedBy string) guardian.Subject {
	payload := map[string]interface{}{"name": sched.Name}
	if sched.CronExpression != "" {
		payload["cronExpression"] = sched.CronExpression
	}
	if s.db != nil {
		if tmpl, err := s.db.GetTemplate(sched.TemplateID); err == nil && tmpl != nil {
			payload["scriptContent"] = tmpl.ScriptContent
			payload["cpuLimit"] = tmpl.CPULimit
			payload["memLimit"] = tmpl.MemLimit
			payload["parallelism"] = tmpl.Parallelism
			payload["runnerImage"] = tmpl.RunnerImage
		}
	}

	environment := ""
	if cfg := s.getClusterConfig(sched.ClusterID); cfg != nil {
		environment = normalizeEnvironment(cfg.Environment, cfg.Name)
	}

	subjectType := guardian.SubjectTestLaunch
	if sched.CronExpression != "" {
		subjectType = guardian.SubjectScheduleNew
	}

	return guardian.Subject{
		Type:        subjectType,
		Ref:         sched.Name,
		RequestedBy: requestedBy,
		ClusterID:   sched.ClusterID,
		Namespace:   sched.Namespace,
		Environment: environment,
		Payload:     payload,
	}
}

func subjectFromRequest(body guardianValidateRequest, requestedBy string) guardian.Subject {
	if body.Payload == nil {
		body.Payload = map[string]interface{}{}
	}
	return guardian.Subject{
		Type:        body.SubjectType,
		Ref:         body.SubjectRef,
		RequestedBy: requestedBy,
		ClusterID:   body.ClusterID,
		Namespace:   body.Namespace,
		Environment: body.Environment,
		Payload:     body.Payload,
	}
}

type guardianValidateRequest struct {
	SubjectType string                 `json:"subject_type"`
	SubjectRef  string                 `json:"subject_ref"`
	ClusterID   string                 `json:"cluster_id"`
	Namespace   string                 `json:"namespace"`
	Environment string                 `json:"environment"`
	Payload     map[string]interface{} `json:"payload"`
}

var validGuardianSubjects = map[string]bool{
	guardian.SubjectTestLaunch:  true,
	guardian.SubjectScheduleNew: true,
	guardian.SubjectRBACChange:  true,
	guardian.SubjectTokenGrant:  true,
}

// handleGuardianValidate kicks off an async Guardian validation run and
// immediately returns its id so the caller can open the SSE stream (or
// poll GET /runs/{id}) to watch agents report in.
func (s *Server) handleGuardianValidate(w http.ResponseWriter, r *http.Request) {
	var body guardianValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if !validGuardianSubjects[body.SubjectType] {
		http.Error(w, `{"error":"subject_type must be one of test_launch, schedule_create, rbac_change, token_grant"}`, http.StatusBadRequest)
		return
	}

	requestedBy := r.Header.Get("X-User-Name")
	subject := subjectFromRequest(body, requestedBy)

	// Run the (potentially multi-second, LLM-backed) evaluation in the
	// background; the frontend streams live progress over SSE.
	runID := "val_" + uuid.New().String()
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		s.runGuardianWithID(bgCtx, runID, subject, true)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"id":           runID,
		"stream_url":   fmt.Sprintf("/api/v1/guardian/runs/%s/stream", runID),
		"subject_type": body.SubjectType,
	})
}

// runGuardianWithID is identical to runGuardian but lets the caller
// pre-allocate the run id, so the HTTP handler can hand it back to the
// client before evaluation completes.
func (s *Server) runGuardianWithID(ctx context.Context, runID string, subject guardian.Subject, publish bool) guardian.Report {
	now := time.Now()
	payloadJSON, _ := json.Marshal(subject.Payload)
	run := &database.ValidationRun{
		ID:             runID,
		SubjectType:    subject.Type,
		SubjectRef:     subject.Ref,
		RequestedBy:    subject.RequestedBy,
		ClusterID:      subject.ClusterID,
		Namespace:      subject.Namespace,
		Environment:    subject.Environment,
		PayloadJSON:    string(payloadJSON),
		OverallVerdict: "pending",
		CreatedAt:      now,
	}
	if s.db != nil {
		if err := s.db.CreateValidationRun(run); err != nil {
			log.Printf("guardian: failed to persist validation run %s: %v", runID, err)
		}
	}

	onFinding := func(f guardian.Finding) {
		if s.db != nil {
			_ = s.db.AddValidationFinding(&database.ValidationFinding{
				ValidationRunID: runID,
				AgentName:       f.Agent,
				Severity:        string(f.Severity),
				Category:        f.Category,
				Message:         f.Message,
				SuggestedFix:    f.SuggestedFix,
				RawOutput:       f.Raw,
				CreatedAt:       time.Now(),
			})
		}
		if publish {
			s.guardianBus.publish(runID, guardianEvent{Finding: &f})
		}
	}

	report := s.guardianCoordinator.Evaluate(ctx, subject, onFinding)

	if s.db != nil {
		_ = s.db.UpdateValidationRunVerdict(runID, string(report.Verdict), report.Score, time.Now())
	}
	s.audit("guardian.validate", subject.RequestedBy, fmt.Sprintf("%s:%s", subject.Type, subject.Ref), map[string]interface{}{
		"validation_run_id": runID,
		"verdict":           report.Verdict,
		"score":             report.Score,
	})

	if publish {
		s.guardianBus.publish(runID, guardianEvent{Done: true, Report: &report})
		s.guardianBus.closeAndDelete(runID)
	}
	return report
}

// handleGuardianStream streams per-agent findings for a run over SSE as
// they land, then a final `done` event with the merged report.
func (s *Server) handleGuardianStream(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	send := func(ev guardianEvent) {
		data, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Fast path: the run has already finished (fast deterministic-only
	// runs can complete before the client even opens the stream). Replay
	// what we have from the database and return.
	if s.replayCompletedGuardianRun(w, runID, send) {
		return
	}

	ch := s.guardianBus.subscribe(runID)
	defer s.guardianBus.unsubscribe(runID, ch)

	// Close the race window: the run may have completed between our
	// initial check and the subscribe call above.
	if s.replayCompletedGuardianRun(w, runID, send) {
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-ch:
			if !open {
				return
			}
			send(ev)
			if ev.Done {
				return
			}
		}
	}
}

// replayCompletedGuardianRun checks whether a run has already finished
// and, if so, emits its stored findings plus a final done event. Returns
// true if it handled (and the caller should stop), false if the run is
// still pending.
func (s *Server) replayCompletedGuardianRun(w http.ResponseWriter, runID string, send func(guardianEvent)) bool {
	if s.db == nil {
		return false
	}
	run, err := s.db.GetValidationRun(runID)
	if err != nil || run == nil || run.CompletedAt == nil {
		return false
	}
	findings, _ := s.db.GetValidationFindings(runID)
	for _, f := range findings {
		gf := guardian.Finding{
			Agent: f.AgentName, Severity: guardian.Severity(f.Severity), Category: f.Category,
			Message: f.Message, SuggestedFix: f.SuggestedFix, Raw: f.RawOutput,
		}
		send(guardianEvent{Finding: &gf})
	}
	report := guardian.Report{Verdict: guardian.Verdict(run.OverallVerdict), Score: run.OverallScore}
	send(guardianEvent{Done: true, Report: &report})
	return true
}

// handleGuardianGetRun is the polling fallback for clients that cannot
// use SSE (or want to re-fetch after a page reload).
func (s *Server) handleGuardianGetRun(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	run, err := s.db.GetValidationRun(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	if run == nil {
		http.Error(w, `{"error":"validation run not found"}`, http.StatusNotFound)
		return
	}
	findings, _ := s.db.GetValidationFindings(id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"run":      run,
		"findings": findings,
	})
}

// handleGuardianListRuns lists past validation runs (paginated) for the
// audit/history view.
func (s *Server) handleGuardianListRuns(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	runs, err := s.db.ListValidationRuns(limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

// handleGuardianOverride lets an administrator proceed past a BLOCK
// verdict (including a deterministic, unbypassable policy block) with a
// mandatory, audited justification. This is the "approval workflow for
// dangerous actions in production" called out in the original spec.
func (s *Server) handleGuardianOverride(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	var body struct {
		Note string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Note) == "" {
		http.Error(w, `{"error":"a written justification (note) is required to override a Guardian block"}`, http.StatusBadRequest)
		return
	}

	overrideBy := r.Header.Get("X-User-Name")
	if err := s.db.OverrideValidationRun(id, overrideBy, body.Note); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}
	s.audit("guardian.override", overrideBy, id, map[string]interface{}{"note": body.Note})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "overridden"})
}

// guardianGate is called synchronously from mutation handlers (test
// launch, schedule create, ...) that were given a validation_run_id by
// the frontend after a preflight check. It enforces the verdict: PASS
// always proceeds, WARN proceeds (advisory only), BLOCK is rejected
// unless the run has since been overridden by an administrator.
//
// If no validation_run_id is supplied at all (e.g. an older API client,
// or CI/CD automation that has not adopted Guardian yet), it runs a fast
// synchronous deterministic-only check inline so dangerous actions are
// never completely unguarded, while remaining backward compatible with
// existing automation.
func (s *Server) guardianGate(ctx context.Context, r *http.Request, subject guardian.Subject, suppliedRunID string) error {
	if s.guardianCoordinator == nil {
		return nil
	}

	if suppliedRunID == "" {
		runID := "val_" + uuid.New().String()
		report := s.runGuardianWithID(ctx, runID, subject, false)
		if report.Verdict == guardian.VerdictBlock {
			return fmt.Errorf("blocked by Guardian preflight checks (validation_run_id=%s): %s", runID, summarizeBlockingFindings(report))
		}
		return nil
	}

	if s.db == nil {
		return nil
	}
	run, err := s.db.GetValidationRun(suppliedRunID)
	if err != nil || run == nil {
		return fmt.Errorf("validation_run_id %q not found; run a preflight check first", suppliedRunID)
	}
	if run.OverallVerdict != string(guardian.VerdictBlock) || run.Overridden {
		return nil
	}
	return fmt.Errorf("blocked by Guardian: validation run %s was rejected and has not been overridden by an administrator", suppliedRunID)
}

func summarizeBlockingFindings(report guardian.Report) string {
	var messages []string
	for _, f := range report.Findings {
		if f.Severity == guardian.SeverityBlock {
			messages = append(messages, f.Message)
		}
	}
	if len(messages) == 0 {
		return "policy violation"
	}
	return strings.Join(messages, "; ")
}
