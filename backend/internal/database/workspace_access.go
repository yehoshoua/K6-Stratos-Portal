package database

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
)

// Workspace membership source constants
const (
	MembershipSourceManual = "manual"
	MembershipSourceSSO    = "sso"
)

// Workspace role constants
const (
	WorkspaceRoleViewer       = "viewer"
	WorkspaceRoleEditor       = "editor"
	WorkspaceRoleAdministrator = "administrator"
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

// workspaceRoleRank returns a numeric rank for a workspace role.
// Higher rank = higher privilege. Used to resolve role conflicts when a user
// belongs to multiple SSO groups with different roles.
func workspaceRoleRank(role string) int {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case WorkspaceRoleAdministrator, "admin":
		return 3
	case WorkspaceRoleEditor, "edit":
		return 2
	case WorkspaceRoleViewer, "view":
		return 1
	default:
		return 0
	}
}

// higherWorkspaceRole returns the role with the highest privilege level.
// Used during SSO sync to determine the effective role when a user matches
// multiple group mappings with different roles.
func higherWorkspaceRole(current, candidate string) string {
	if workspaceRoleRank(candidate) > workspaceRoleRank(current) {
		return candidate
	}
	return current
}

// normalizeIDPGroup normalizes an IDP group name to lowercase and trimmed.
// Used consistently across all group comparisons to handle case-insensitive matching.
func normalizeIDPGroup(group string) string {
	return strings.ToLower(strings.TrimSpace(group))
}

// isValidWorkspaceRole validates that a role is one of the allowed workspace roles.
func isValidWorkspaceRole(role string) bool {
	role = strings.TrimSpace(role)
	return role == WorkspaceRoleViewer || role == WorkspaceRoleEditor || role == WorkspaceRoleAdministrator
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
	} else {
		// SQLite: check if source column exists
		var hasSource bool
		rows, err := db.conn.Query("PRAGMA table_info(workspace_users);")
		if err == nil {
			for rows.Next() {
				var cid, notnull, pk int
				var name, ctype string
				var dfltVal sql.NullString
				if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltVal, &pk); err == nil && name == "source" {
					hasSource = true
					break
				}
			}
			rows.Close()
		}
		if !hasSource {
			if _, err := db.conn.Exec("ALTER TABLE workspace_users ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';"); err != nil {
				return fmt.Errorf("failed to migrate workspace_users.source column: %w", err)
			}
		}
	}

	// Create indexes for performance
	if err := db.ensureWorkspaceAccessIndexes(); err != nil {
		log.Printf("Warning: failed to create workspace access indexes: %v", err)
	}

	return nil
}

func (db *DB) ensureWorkspaceAccessIndexes() error {
	// Index for workspace_group_mappings by workspace_id for faster lookups
	if db.driver == "postgres" {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_group_mappings_workspace_id ON workspace_group_mappings(workspace_id)")
	} else {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_group_mappings_workspace_id ON workspace_group_mappings(workspace_id)")
	}

	// Index for workspace_users by username for GetWorkspaceMembershipsForUser() queries
	if db.driver == "postgres" {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_users_username ON workspace_users(username)")
	} else {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_users_username ON workspace_users(username)")
	}

	// Index for workspace_users by workspace_id for GetWorkspaceUsers() queries
	if db.driver == "postgres" {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace_id ON workspace_users(workspace_id)")
	} else {
		_, _ = db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_workspace_users_workspace_id ON workspace_users(workspace_id)")
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
	if mapping == nil || mapping.WorkspaceID == "" {
		return fmt.Errorf("workspace_id is required")
	}
	
	idpGroup := normalizeIDPGroup(mapping.IDPGroup)
	if idpGroup == "" {
		return fmt.Errorf("idp_group cannot be empty or whitespace only")
	}
	
	if !isValidWorkspaceRole(mapping.Role) {
		return fmt.Errorf("invalid role: must be %s, %s, or %s", WorkspaceRoleViewer, WorkspaceRoleEditor, WorkspaceRoleAdministrator)
	}
	
	query := db.rebind(`
		INSERT INTO workspace_group_mappings (workspace_id, idp_group, role)
		VALUES (?, ?, ?)
		ON CONFLICT (workspace_id, idp_group) DO UPDATE SET role = excluded.role`)
	if db.driver != "postgres" {
		query = `
			INSERT OR REPLACE INTO workspace_group_mappings (workspace_id, idp_group, role)
			VALUES (?, ?, ?);`
	}
	_, err := db.conn.Exec(query, mapping.WorkspaceID, idpGroup, mapping.Role)
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
	if wu.WorkspaceID == "" || wu.Username == "" {
		return fmt.Errorf("workspace_id and username are required")
	}
	if !isValidWorkspaceRole(wu.Role) {
		return fmt.Errorf("invalid role: must be %s, %s, or %s", WorkspaceRoleViewer, WorkspaceRoleEditor, WorkspaceRoleAdministrator)
	}
	
	source = strings.TrimSpace(source)
	if source != MembershipSourceManual && source != MembershipSourceSSO {
		source = MembershipSourceManual
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

	// Track changes for logging
	added := 0
	updated := 0
	removed := 0

	// Add or update SSO-provisioned workspace memberships
	for workspaceID, role := range desiredRoles {
		current := existingByWorkspace[workspaceID]
		if current != nil && current.Source == MembershipSourceManual {
			// Don't override manual memberships with SSO
			continue
		}
		
		if current == nil {
			added++
		} else if current.Role != role {
			updated++
		}
		
		if err := db.SaveWorkspaceUserWithSource(&WorkspaceUser{
			WorkspaceID: workspaceID,
			Username:    username,
			Role:        role,
		}, MembershipSourceSSO); err != nil {
			return err
		}
	}

	// Remove SSO-provisioned memberships that are no longer valid
	for _, membership := range existing {
		if membership.Source != MembershipSourceSSO {
			continue
		}
		if _, ok := desiredRoles[membership.WorkspaceID]; ok {
			continue
		}
		removed++
		if err := db.DeleteWorkspaceUser(membership.WorkspaceID, username); err != nil {
			return err
		}
	}

	if added > 0 || updated > 0 || removed > 0 {
		log.Printf("Synced user %s: added %d workspace(s), updated %d, removed %d", username, added, updated, removed)
	}

	return nil
}
