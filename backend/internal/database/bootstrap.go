package database

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"time"
)

// BootstrapAdmin is explicit and never resets credentials in an existing database.
func (db *DB) BootstrapAdmin(password string) error {
	var count int
	if err := db.conn.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(password) < 16 || len(password) > 72 {
		return fmt.Errorf("a new database requires BOOTSTRAP_ADMIN_PASSWORD (16-72 bytes)")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.conn.Exec(db.rebind(`INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (username) DO NOTHING`), "admin", string(hash), "", "administrator", time.Now())
	return err
}
