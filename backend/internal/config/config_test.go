package config

import (
	"encoding/base64"
	"testing"
)

func TestProductionRejectsInvalidEncryptionKeys(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "test-signing-secret-32-bytes-long!")
	for _, key := range []string{"", "invalid", base64.StdEncoding.EncodeToString([]byte("short")), "12345678901234567890123456789012"} {
		t.Setenv("ENCRYPTION_KEY", key)
		if _, err := LoadConfig(); err == nil {
			t.Errorf("accepted invalid key of length %d", len(key))
		}
	}
	t.Setenv("ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cfg.Encrypt([]byte("round-trip"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cfg.Decrypt(encrypted)
	if err != nil || string(raw) != "round-trip" {
		t.Fatal("encryption round trip failed")
	}
}
func TestDevelopmentDefaultKeyWorks(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("ENCRYPTION_KEY", "")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.Encrypt([]byte("test")); err != nil {
		t.Fatal(err)
	}
}
