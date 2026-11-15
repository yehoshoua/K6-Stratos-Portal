package database

import (
	"golang.org/x/crypto/bcrypt"
	"path/filepath"
	"testing"
)

func TestBootstrapRequiresExplicitPasswordAndPreservesExistingUsers(t *testing.T) {
	db, err := InitDB("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if user, _ := db.GetUser("admin"); user != nil {
		t.Fatal("implicit administrator created")
	}
	if err := db.BootstrapAdmin(""); err == nil {
		t.Fatal("empty bootstrap password accepted")
	}
	if err := db.BootstrapAdmin("test-bootstrap-password"); err != nil {
		t.Fatal(err)
	}
	before, err := db.GetUser("admin")
	if err != nil {
		t.Fatal(err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(before.PasswordHash), []byte("test-bootstrap-password")); err != nil {
		t.Fatal(err)
	}
	if err := db.BootstrapAdmin("different-password"); err != nil {
		t.Fatal(err)
	}
	after, _ := db.GetUser("admin")
	if before.PasswordHash != after.PasswordHash {
		t.Fatal("existing password reset")
	}
}

func TestSSOAccountWriteCannotOverwriteLocalOrOtherIdentity(t *testing.T) {
	db, err := InitDB("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.BootstrapAdmin("test-bootstrap-password"); err != nil {
		t.Fatal(err)
	}
	local, err := db.GetUser("admin")
	if err != nil {
		t.Fatal(err)
	}
	candidate := *local
	candidate.PasswordHash = ""
	candidate.Salt = "oidc:identity-a"
	if err := db.SaveSSOUser(&candidate); err == nil {
		t.Fatal("OIDC write replaced local credentials")
	}
	candidate.Username = "sso-user"
	if err := db.SaveSSOUser(&candidate); err != nil {
		t.Fatal(err)
	}
	candidate.Salt = "oidc:identity-b"
	if err := db.SaveSSOUser(&candidate); err == nil {
		t.Fatal("different OIDC identity replaced existing account")
	}
	candidate.Salt = "oidc:identity-a"
	candidate.Role = "viewer"
	if err := db.SaveSSOUser(&candidate); err != nil {
		t.Fatal(err)
	}
	saved, err := db.GetUser(candidate.Username)
	if err != nil || saved.Role != "viewer" {
		t.Fatal("same identity could not update role")
	}
	after, err := db.GetUser("admin")
	if err != nil || after.PasswordHash != local.PasswordHash {
		t.Fatal("local account changed")
	}
}
