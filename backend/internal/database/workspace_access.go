package database

import (
	"database/sql"
	"fmt"
	"strings"
)

type WorkspaceGroupMapping struct {
	WorkspaceID string `json:"workspace_id"`
	IDPGroup    string `json:"idp_group"`
	Role        string `json:"role"`
}

type UserWorkspaceMembership struct {
	WorkspaceID   string `json:"workspace_id"`
	WorkspaceName string `json:"workspace_name,omitempty"`
	Username      string `json:"username"`
	Role          string `json:"role"`
	Source        string `json:"source"`
}

func workspaceRoleRank(role string) int {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "administrator", "admin":
		return 3
	case "editor", "edit":
		return 2
	case "viewer", "view":
		return 1
	default:
		return 0
	}
}

func higherWorkspaceRole(current, candidate string) string {
	if workspaceRoleRank(candidate) > workspaceRoleRank(current) {
		return candidate
	}
	return current
}

func normalizeIDPGroup(group string) string {
	return strings.ToLower(strings.TrimSpace(group))
}

func (db *DB) ensureWorkspaceAccessTables() error {
	mappingsTable := `
	CREATE TABLE IF NOT EXISTS workspace_group_mappings (
		workspace_id TEXT NOT NULL,
		idp_group TEXT NOT NULL,
		role TEXT NOT NULL,
		PRIMARY KEY (workspace_id, idp_group)
	);`
	if _, err := db.conn.Exec(mappingsTable); err != nil {
		return fmt.Errorf("failed to create workspace_group_mappings table: %w", err)
	}

	if db.driver == "postgres" {
		stmt := "ALTER TABLE workspace_users ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';"
		if _, err := db.conn.Exec(stmt); err != nil {
			return fmt.Errorf("failed to migrate workspace_users.source column: %w", err)
		}
		return nil
	}

	var hasSource bool
	rows, err := db.conn.Query("PRAGMA table_info(workspace_users);")
	if err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dfltVal sql.NullString
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil && name == "source" {
				hasSource = true
			}
		}
		rows.Close()
	}
	if !hasSource {
		if _, err := db.conn.Exec("ALTER TABLE workspace_users ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';"); err != nil {
			return fmt.Errorf("failed to migrate workspace_users.source column: %w", err)
		}
	}
	return nil
}

func (db *DB) GetWorkspaceGroupMappings(workspaceID string) ([]*WorkspaceGroupMapping, error) {
	query := db.rebind(`
		SELECT workspace_id, idp_group, role
		FROM workspace_group_mappings
		WHERE workspace_id = ?
		ORDER BY idp_group ASC`)
	rows, err := db.conn.Query(query, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*WorkspaceGroupMapping
	for rows.Next() {
		var mapping WorkspaceGroupMapping
		if err := rows.Scan(&mapping.WorkspaceID, &mapping.IDPGroup, &mapping.Role); err != nil {
			return nil, err
		}
		list = append(list, &mapping)
	}
	return list, nil
}

func (db *DB) SaveWorkspaceGroupMapping(mapping *WorkspaceGroupMapping) error {
	if mapping == nil || mapping.WorkspaceID == "" || mapping.IDPGroup == "" || mapping.Role == "" {
		return fmt.Errorf("workspace_id, idp_group and role are required")
	}
	mapping.IDPGroup = strings.TrimSpace(mapping.IDPGroup)
	query := db.rebind(`
		INSERT INTO workspace_group_mappings (workspace_id, idp_group, role)
		VALUES (?, ?, ?)
		ON CONFLICT (workspace_id, idp_group) DO UPDATE SET role = excluded.role`)
	if db.driver != "postgres" {
		query = `
			INSERT OR REPLACE INTO workspace_group_mappings (workspace_id, idp_group, role)
			VALUES (?, ?, ?);`
	}
	_, err := db.conn.Exec(query, mapping.WorkspaceID, mapping.IDPGroup, mapping.Role)
	return err
}

func (db *DB) DeleteWorkspaceGroupMapping(workspaceID, idpGroup string) error {
	query := db.rebind("DELETE FROM workspace_group_mappings WHERE workspace_id = ? AND LOWER(idp_group) = LOWER(?)")
	_, err := db.conn.Exec(query, workspaceID, strings.TrimSpace(idpGroup))
	return err
}

func (db *DB) DeleteWorkspaceGroupMappings(workspaceID string) error {
	query := db.rebind("DELETE FROM workspace_group_mappings WHERE workspace_id = ?")
	_, err := db.conn.Exec(query, workspaceID)
	return err
}

func (db *DB) GetWorkspaceMembershipsForUser(username string) ([]*UserWorkspaceMembership, error) {
	query := db.rebind(`
		SELECT wu.workspace_id, w.name, wu.username, wu.role, COALESCE(wu.source, 'manual')
		FROM workspace_users wu
		JOIN workspaces w ON w.id = wu.workspace_id
		WHERE wu.username = ?
		ORDER BY w.name ASC`)
	rows, err := db.conn.Query(query, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*UserWorkspaceMembership
	for rows.Next() {
		var membership UserWorkspaceMembership
		if err := rows.Scan(&membership.WorkspaceID, &membership.WorkspaceName, &membership.Username, &membership.Role, &membership.Source); err != nil {
			return nil, err
		}
		list = append(list, &membership)
	}
	return list, nil
}

func (db *DB) GetAllWorkspaceMemberships() ([]*UserWorkspaceMembership, error) {
	query := db.rebind(`
		SELECT wu.workspace_id, w.name, wu.username, wu.role, COALESCE(wu.source, 'manual')
		FROM workspace_users wu
		JOIN workspaces w ON w.id = wu.workspace_id
		ORDER BY wu.username ASC, w.name ASC`)
	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*UserWorkspaceMembership
	for rows.Next() {
		var membership UserWorkspaceMembership
		if err := rows.Scan(&membership.WorkspaceID, &membership.WorkspaceName, &membership.Username, &membership.Role, &membership.Source); err != nil {
			return nil, err
		}
		list = append(list, &membership)
	}
	return list, nil
}

func (db *DB) DeleteWorkspaceUser(workspaceID, username string) error {
	query := db.rebind("DELETE FROM workspace_users WHERE workspace_id = ? AND username = ?")
	_, err := db.conn.Exec(query, workspaceID, username)
	return err
}

func (db *DB) DeleteWorkspaceUsersForUser(username string) error {
	query := db.rebind("DELETE FROM workspace_users WHERE username = ?")
	_, err := db.conn.Exec(query, username)
	return err
}

func (db *DB) SaveWorkspaceUserWithSource(wu *WorkspaceUser, source string) error {
	if wu == nil {
		return fmt.Errorf("workspace user is required")
	}
	if source == "" {
		source = "manual"
	}
	var query string
	if db.driver == "postgres" {
		query = `
		INSERT INTO workspace_users (workspace_id, username, role, source)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id, username) DO UPDATE SET role = excluded.role, source = excluded.source;`
	} else {
		query = "INSERT OR REPLACE INTO workspace_users (workspace_id, username, role, source) VALUES (?, ?, ?, ?);"
	}
	_, err := db.conn.Exec(query, wu.WorkspaceID, wu.Username, wu.Role, source)
	return err
}

func (db *DB) GetWorkspaceUserMembership(workspaceID, username string) (*UserWorkspaceMembership, error) {
	query := db.rebind(`
		SELECT wu.workspace_id, w.name, wu.username, wu.role, COALESCE(wu.source, 'manual')
		FROM workspace_users wu
		JOIN workspaces w ON w.id = wu.workspace_id
		WHERE wu.workspace_id = ? AND wu.username = ?
		LIMIT 1`)
	var membership UserWorkspaceMembership
	err := db.conn.QueryRow(query, workspaceID, username).Scan(
		&membership.WorkspaceID,
		&membership.WorkspaceName,
		&membership.Username,
		&membership.Role,
		&membership.Source,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &membership, nil
}

func (db *DB) SyncUserWorkspaceMembershipsFromGroups(username string, groups []string) error {
	if username == "" {
		return nil
	}

	normalizedGroups := make(map[string]struct{})
	for _, group := range groups {
		normalized := normalizeIDPGroup(group)
		if normalized != "" {
			normalizedGroups[normalized] = struct{}{}
		}
	}

	query := db.rebind("SELECT workspace_id, idp_group, role FROM workspace_group_mappings")
	rows, err := db.conn.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()

	desiredRoles := make(map[string]string)
	for rows.Next() {
		var workspaceID, idpGroup, role string
		if err := rows.Scan(&workspaceID, &idpGroup, &role); err != nil {
			return err
		}
		if _, ok := normalizedGroups[normalizeIDPGroup(idpGroup)]; !ok {
			continue
		}
		current := desiredRoles[workspaceID]
		desiredRoles[workspaceID] = higherWorkspaceRole(current, role)
	}

	existing, err := db.GetWorkspaceMembershipsForUser(username)
	if err != nil {
		return err
	}
	existingByWorkspace := make(map[string]*UserWorkspaceMembership)
	for _, membership := range existing {
		existingByWorkspace[membership.WorkspaceID] = membership
	}

	for workspaceID, role := range desiredRoles {
		current := existingByWorkspace[workspaceID]
		if current != nil && current.Source == "manual" {
			continue
		}
		if err := db.SaveWorkspaceUserWithSource(&WorkspaceUser{
			WorkspaceID: workspaceID,
			Username:    username,
			Role:        role,
		}, "sso"); err != nil {
			return err
		}
	}

	for _, membership := range existing {
		if membership.Source != "sso" {
			continue
		}
		if _, ok := desiredRoles[membership.WorkspaceID]; ok {
			continue
		}
		if err := db.DeleteWorkspaceUser(membership.WorkspaceID, username); err != nil {
			return err
		}
	}

	return nil
}
