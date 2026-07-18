package database

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// Guardian verdict/severity levels shared across the deterministic policy
// engine and the LLM specialist agents. Kept as plain strings (not a Go
// enum) so they round-trip cleanly through JSON and SQL without casts.
const (
	VerdictPass  = "pass"
	VerdictWarn  = "warn"
	VerdictBlock = "block"

	SeverityInfo  = "info"
	SeverityWarn  = "warn"
	SeverityBlock = "block"

	SubjectTestLaunch  = "test_launch"
	SubjectScheduleNew = "schedule_create"
	SubjectRBACChange  = "rbac_change"
	SubjectTokenGrant  = "token_grant"
)

// ValidationRun is one invocation of the Guardian multi-agent pipeline.
type ValidationRun struct {
	ID             string     `json:"id"`
	SubjectType    string     `json:"subject_type"`
	SubjectRef     string     `json:"subject_ref"`
	RequestedBy    string     `json:"requested_by"`
	ClusterID      string     `json:"cluster_id,omitempty"`
	Namespace      string     `json:"namespace,omitempty"`
	Environment    string     `json:"environment,omitempty"`
	PayloadJSON    string     `json:"payload_json,omitempty"`
	OverallVerdict string     `json:"overall_verdict"`
	OverallScore   int        `json:"overall_score"`
	Overridden     bool       `json:"overridden"`
	OverrideBy     string     `json:"override_by,omitempty"`
	OverrideNote   string     `json:"override_note,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

// ValidationFinding is a single agent's (or the policy engine's) opinion
// attached to a ValidationRun.
type ValidationFinding struct {
	ID              int       `json:"id"`
	ValidationRunID string    `json:"validation_run_id"`
	AgentName       string    `json:"agent_name"`
	Severity        string    `json:"severity"`
	Category        string    `json:"category"`
	Message         string    `json:"message"`
	SuggestedFix    string    `json:"suggested_fix,omitempty"`
	RawOutput       string    `json:"raw_output,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// GuardianPolicy lets admins tune deterministic hard-block thresholds
// without a redeploy (e.g. protected namespace list, max CPU/memory).
type GuardianPolicy struct {
	ID          string    `json:"id"`
	RuleKey     string    `json:"rule_key"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	Config      string    `json:"config"` // JSON blob, shape depends on rule_key
	UpdatedAt   time.Time `json:"updated_at"`
}

// AuditLog is a single immutable record of a security-relevant action.
type AuditLog struct {
	ID        int       `json:"id"`
	Action    string    `json:"action"`
	Actor     string    `json:"actor"`
	Target    string    `json:"target,omitempty"`
	Metadata  string    `json:"metadata,omitempty"`
	IPAddress string    `json:"ip_address,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// UserScope narrows a user's role to a specific AWS account, cluster,
// namespace, and/or environment (ABAC on top of the existing RBAC role).
// Empty string fields mean "any" for that dimension.
type UserScope struct {
	ID           int    `json:"id"`
	Username     string `json:"username"`
	AWSAccountID string `json:"aws_account_id,omitempty"`
	ClusterID    string `json:"cluster_id,omitempty"`
	Namespace    string `json:"namespace,omitempty"`
	Environment  string `json:"environment,omitempty"`
}

// createGuardianTables creates every table introduced by the Guardian
// multi-agent validation runtime and the surrounding identity/audit
// hardening work. Safe to call on every startup (IF NOT EXISTS).
func (db *DB) createGuardianTables() error {
	var validationRunsTable, validationFindingsTable, auditLogsTable, userScopesTable string

	if db.driver == "postgres" {
		validationRunsTable = `
		CREATE TABLE IF NOT EXISTS validation_runs (
			id TEXT PRIMARY KEY,
			subject_type TEXT NOT NULL,
			subject_ref TEXT NOT NULL DEFAULT '',
			requested_by TEXT NOT NULL DEFAULT '',
			cluster_id TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '',
			overall_verdict TEXT NOT NULL DEFAULT 'pass',
			overall_score INTEGER NOT NULL DEFAULT 0,
			overridden INTEGER NOT NULL DEFAULT 0,
			override_by TEXT NOT NULL DEFAULT '',
			override_note TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL,
			completed_at TIMESTAMP
		);`
		validationFindingsTable = `
		CREATE TABLE IF NOT EXISTS validation_findings (
			id SERIAL PRIMARY KEY,
			validation_run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
			agent_name TEXT NOT NULL,
			severity TEXT NOT NULL,
			category TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			suggested_fix TEXT NOT NULL DEFAULT '',
			raw_output TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL
		);`
		auditLogsTable = `
		CREATE TABLE IF NOT EXISTS audit_logs (
			id SERIAL PRIMARY KEY,
			action TEXT NOT NULL,
			actor TEXT NOT NULL DEFAULT '',
			target TEXT NOT NULL DEFAULT '',
			metadata TEXT NOT NULL DEFAULT '',
			ip_address TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL
		);`
		userScopesTable = `
		CREATE TABLE IF NOT EXISTS user_scopes (
			id SERIAL PRIMARY KEY,
			username TEXT NOT NULL,
			aws_account_id TEXT NOT NULL DEFAULT '',
			cluster_id TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT ''
		);`
	} else {
		validationRunsTable = `
		CREATE TABLE IF NOT EXISTS validation_runs (
			id TEXT PRIMARY KEY,
			subject_type TEXT NOT NULL,
			subject_ref TEXT NOT NULL DEFAULT '',
			requested_by TEXT NOT NULL DEFAULT '',
			cluster_id TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '',
			overall_verdict TEXT NOT NULL DEFAULT 'pass',
			overall_score INTEGER NOT NULL DEFAULT 0,
			overridden INTEGER NOT NULL DEFAULT 0,
			override_by TEXT NOT NULL DEFAULT '',
			override_note TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL,
			completed_at TIMESTAMP
		);`
		validationFindingsTable = `
		CREATE TABLE IF NOT EXISTS validation_findings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			validation_run_id TEXT NOT NULL,
			agent_name TEXT NOT NULL,
			severity TEXT NOT NULL,
			category TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			suggested_fix TEXT NOT NULL DEFAULT '',
			raw_output TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL
		);`
		auditLogsTable = `
		CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			action TEXT NOT NULL,
			actor TEXT NOT NULL DEFAULT '',
			target TEXT NOT NULL DEFAULT '',
			metadata TEXT NOT NULL DEFAULT '',
			ip_address TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL
		);`
		userScopesTable = `
		CREATE TABLE IF NOT EXISTS user_scopes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			aws_account_id TEXT NOT NULL DEFAULT '',
			cluster_id TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			environment TEXT NOT NULL DEFAULT ''
		);`
	}

	guardianPoliciesTable := `
	CREATE TABLE IF NOT EXISTS guardian_policies (
		id TEXT PRIMARY KEY,
		rule_key TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		enabled INTEGER NOT NULL DEFAULT 1,
		config TEXT NOT NULL DEFAULT '{}',
		updated_at TIMESTAMP NOT NULL
	);`

	for name, stmt := range map[string]string{
		"validation_runs":     validationRunsTable,
		"validation_findings": validationFindingsTable,
		"guardian_policies":   guardianPoliciesTable,
		"audit_logs":          auditLogsTable,
		"user_scopes":         userScopesTable,
	} {
		if _, err := db.conn.Exec(stmt); err != nil {
			return fmt.Errorf("failed to create %s table: %w", name, err)
		}
	}

	// SCIM-readiness hook column called out in docs/architecture_design.md
	// section F. No sync logic yet, just the column so it does not require
	// another destructive migration later.
	db.ensureColumn("users", "external_id", "TEXT DEFAULT ''")

	return nil
}

// ensureColumn is a small generic helper mirroring the ad-hoc
// ensure*Column functions already in this package, so future migrations
// do not need to hand-roll PRAGMA table_info / information_schema checks.
func (db *DB) ensureColumn(table, column, ddl string) {
	if db.driver == "postgres" {
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s %s;", table, column, ddl)
		if _, err := db.conn.Exec(stmt); err != nil {
			log.Printf("Warning: failed to migrate %s.%s: %v", table, column, err)
		}
		return
	}

	hasColumn := false
	rows, err := db.conn.Query(fmt.Sprintf("PRAGMA table_info(%s);", table))
	if err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dfltVal sql.NullString
			if scanErr := rows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); scanErr == nil && name == column {
				hasColumn = true
			}
		}
		rows.Close()
	}
	if !hasColumn {
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s;", table, column, ddl)
		if _, err := db.conn.Exec(stmt); err != nil {
			log.Printf("Warning: failed to migrate %s.%s: %v", table, column, err)
		}
	}
}

// --- Validation Runs / Findings ---

func (db *DB) CreateValidationRun(v *ValidationRun) error {
	query := db.rebind(`
		INSERT INTO validation_runs (id, subject_type, subject_ref, requested_by, cluster_id, namespace, environment, payload_json, overall_verdict, overall_score, overridden, override_by, override_note, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`)
	overridden := 0
	if v.Overridden {
		overridden = 1
	}
	_, err := db.conn.Exec(query, v.ID, v.SubjectType, v.SubjectRef, v.RequestedBy, v.ClusterID, v.Namespace, v.Environment,
		v.PayloadJSON, v.OverallVerdict, v.OverallScore, overridden, v.OverrideBy, v.OverrideNote, v.CreatedAt, v.CompletedAt)
	return err
}

func (db *DB) UpdateValidationRunVerdict(id, verdict string, score int, completedAt time.Time) error {
	query := db.rebind(`UPDATE validation_runs SET overall_verdict = ?, overall_score = ?, completed_at = ? WHERE id = ?;`)
	_, err := db.conn.Exec(query, verdict, score, completedAt, id)
	return err
}

func (db *DB) OverrideValidationRun(id, overrideBy, note string) error {
	query := db.rebind(`UPDATE validation_runs SET overridden = 1, override_by = ?, override_note = ? WHERE id = ?;`)
	_, err := db.conn.Exec(query, overrideBy, note, id)
	return err
}

func (db *DB) GetValidationRun(id string) (*ValidationRun, error) {
	query := db.rebind(`SELECT id, subject_type, subject_ref, requested_by, cluster_id, namespace, environment, payload_json, overall_verdict, overall_score, overridden, override_by, override_note, created_at, completed_at FROM validation_runs WHERE id = ? LIMIT 1;`)
	var v ValidationRun
	var overridden int
	var completedAt sql.NullTime
	err := db.conn.QueryRow(query, id).Scan(&v.ID, &v.SubjectType, &v.SubjectRef, &v.RequestedBy, &v.ClusterID, &v.Namespace, &v.Environment,
		&v.PayloadJSON, &v.OverallVerdict, &v.OverallScore, &overridden, &v.OverrideBy, &v.OverrideNote, &v.CreatedAt, &completedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	v.Overridden = overridden == 1
	if completedAt.Valid {
		v.CompletedAt = &completedAt.Time
	}
	return &v, nil
}

func (db *DB) ListValidationRuns(limit, offset int) ([]*ValidationRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := db.rebind(`SELECT id, subject_type, subject_ref, requested_by, cluster_id, namespace, environment, payload_json, overall_verdict, overall_score, overridden, override_by, override_note, created_at, completed_at FROM validation_runs ORDER BY created_at DESC LIMIT ? OFFSET ?;`)
	rows, err := db.conn.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*ValidationRun, 0)
	for rows.Next() {
		var v ValidationRun
		var overridden int
		var completedAt sql.NullTime
		if err := rows.Scan(&v.ID, &v.SubjectType, &v.SubjectRef, &v.RequestedBy, &v.ClusterID, &v.Namespace, &v.Environment,
			&v.PayloadJSON, &v.OverallVerdict, &v.OverallScore, &overridden, &v.OverrideBy, &v.OverrideNote, &v.CreatedAt, &completedAt); err != nil {
			return nil, err
		}
		v.Overridden = overridden == 1
		if completedAt.Valid {
			v.CompletedAt = &completedAt.Time
		}
		list = append(list, &v)
	}
	return list, nil
}

func (db *DB) AddValidationFinding(f *ValidationFinding) error {
	query := db.rebind(`INSERT INTO validation_findings (validation_run_id, agent_name, severity, category, message, suggested_fix, raw_output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`)
	_, err := db.conn.Exec(query, f.ValidationRunID, f.AgentName, f.Severity, f.Category, f.Message, f.SuggestedFix, f.RawOutput, f.CreatedAt)
	return err
}

func (db *DB) GetValidationFindings(runID string) ([]*ValidationFinding, error) {
	query := db.rebind(`SELECT id, validation_run_id, agent_name, severity, category, message, suggested_fix, raw_output, created_at FROM validation_findings WHERE validation_run_id = ? ORDER BY id ASC;`)
	rows, err := db.conn.Query(query, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*ValidationFinding, 0)
	for rows.Next() {
		var f ValidationFinding
		if err := rows.Scan(&f.ID, &f.ValidationRunID, &f.AgentName, &f.Severity, &f.Category, &f.Message, &f.SuggestedFix, &f.RawOutput, &f.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, &f)
	}
	return list, nil
}

// --- Guardian Policies (admin-tunable hard-block config) ---

func (db *DB) UpsertGuardianPolicy(p *GuardianPolicy) error {
	enabled := 0
	if p.Enabled {
		enabled = 1
	}
	var query string
	if db.driver == "postgres" {
		query = `INSERT INTO guardian_policies (id, rule_key, description, enabled, config, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET rule_key = EXCLUDED.rule_key, description = EXCLUDED.description, enabled = EXCLUDED.enabled, config = EXCLUDED.config, updated_at = EXCLUDED.updated_at;`
	} else {
		query = `INSERT OR REPLACE INTO guardian_policies (id, rule_key, description, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?, ?);`
	}
	_, err := db.conn.Exec(query, p.ID, p.RuleKey, p.Description, enabled, p.Config, p.UpdatedAt)
	return err
}

func (db *DB) ListGuardianPolicies() ([]*GuardianPolicy, error) {
	query := db.rebind(`SELECT id, rule_key, description, enabled, config, updated_at FROM guardian_policies ORDER BY rule_key ASC;`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*GuardianPolicy, 0)
	for rows.Next() {
		var p GuardianPolicy
		var enabled int
		if err := rows.Scan(&p.ID, &p.RuleKey, &p.Description, &enabled, &p.Config, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Enabled = enabled == 1
		list = append(list, &p)
	}
	return list, nil
}

// --- Audit Logs ---

func (db *DB) WriteAuditLog(a *AuditLog) error {
	query := db.rebind(`INSERT INTO audit_logs (action, actor, target, metadata, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?);`)
	_, err := db.conn.Exec(query, a.Action, a.Actor, a.Target, a.Metadata, a.IPAddress, a.CreatedAt)
	return err
}

func (db *DB) ListAuditLogs(limit, offset int) ([]*AuditLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	query := db.rebind(`SELECT id, action, actor, target, metadata, ip_address, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?;`)
	rows, err := db.conn.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*AuditLog, 0)
	for rows.Next() {
		var a AuditLog
		if err := rows.Scan(&a.ID, &a.Action, &a.Actor, &a.Target, &a.Metadata, &a.IPAddress, &a.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, &a)
	}
	return list, nil
}

// --- User Scopes (ABAC) ---

func (db *DB) SaveUserScope(sc *UserScope) error {
	query := db.rebind(`INSERT INTO user_scopes (username, aws_account_id, cluster_id, namespace, environment) VALUES (?, ?, ?, ?, ?);`)
	_, err := db.conn.Exec(query, sc.Username, sc.AWSAccountID, sc.ClusterID, sc.Namespace, sc.Environment)
	return err
}

func (db *DB) GetUserScopes(username string) ([]*UserScope, error) {
	query := db.rebind(`SELECT id, username, aws_account_id, cluster_id, namespace, environment FROM user_scopes WHERE username = ?;`)
	rows, err := db.conn.Query(query, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*UserScope, 0)
	for rows.Next() {
		var sc UserScope
		if err := rows.Scan(&sc.ID, &sc.Username, &sc.AWSAccountID, &sc.ClusterID, &sc.Namespace, &sc.Environment); err != nil {
			return nil, err
		}
		list = append(list, &sc)
	}
	return list, nil
}

func (db *DB) DeleteUserScope(id int) error {
	query := db.rebind(`DELETE FROM user_scopes WHERE id = ?;`)
	_, err := db.conn.Exec(query, id)
	return err
}

func (db *DB) DeleteUserScopesForUser(username string) error {
	query := db.rebind(`DELETE FROM user_scopes WHERE username = ?;`)
	_, err := db.conn.Exec(query, username)
	return err
}
