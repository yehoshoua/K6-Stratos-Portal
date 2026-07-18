package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
)

func setupTestServer(t *testing.T) (*Server, func()) {
	tmpDir, err := os.MkdirTemp("", "k6-stratos-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.InitDB("sqlite3", dbPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to init db: %v", err)
	}

	cfg := &config.Config{
		JWTSecret:     []byte("test-jwt-secret-key-must-be-long-enough-32-bytes"),
		EncryptionKey: []byte("dev-key-must-be-exactly-32bytes!"),
	}

	srv := NewServer(cfg, db)

	cleanup := func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}

	return srv, cleanup
}

func TestSelfServiceTokens(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	// 1. Test creation of token with expiry_days = 7
	t.Run("Create success (expiry_days = 7)", func(t *testing.T) {
		body := map[string]interface{}{
			"name":        "Test Token",
			"expiry_days": 7,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytes))
		req.Header.Set("X-User-Name", "alice")
		req.Header.Set("X-User-Role", "editor")

		w := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(w, req)

		res := w.Result()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("expected status 200, got %d", res.StatusCode)
		}

		var resp map[string]interface{}
		if err := json.NewDecoder(res.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		token, ok := resp["token"].(string)
		if !ok || !strings.HasPrefix(token, "stratum_tok_") {
			t.Fatalf("invalid token format: %v", resp["token"])
		}

		expiresAtStr, _ := resp["expires_at"].(string)
		expiresAt, err := time.Parse(time.RFC3339, expiresAtStr)
		if err != nil {
			t.Fatalf("failed to parse expires_at: %v", err)
		}

		expectedMax := time.Now().AddDate(0, 0, 7)
		if expiresAt.After(expectedMax.Add(time.Minute)) || expiresAt.Before(expectedMax.Add(-time.Minute)) {
			t.Fatalf("unexpected expiration time: %v, expected around %v", expiresAt, expectedMax)
		}
	})

	// 2. Test refusal with expiry_days = 0
	t.Run("Create failure (expiry_days = 0)", func(t *testing.T) {
		body := map[string]interface{}{
			"name":        "Zero Expiry Token",
			"expiry_days": 0,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytes))
		req.Header.Set("X-User-Name", "alice")
		req.Header.Set("X-User-Role", "editor")

		w := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(w, req)

		res := w.Result()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", res.StatusCode)
		}
	})

	// 3. Test refusal with expiry_days = 8
	t.Run("Create failure (expiry_days = 8)", func(t *testing.T) {
		body := map[string]interface{}{
			"name":        "Long Expiry Token",
			"expiry_days": 8,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytes))
		req.Header.Set("X-User-Name", "alice")
		req.Header.Set("X-User-Role", "editor")

		w := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(w, req)

		res := w.Result()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", res.StatusCode)
		}
	})

	// 4. Test refusal of scopes outside role
	t.Run("Create failure (scope escalation)", func(t *testing.T) {
		body := map[string]interface{}{
			"name":        "Escalated Token",
			"expiry_days": 5,
			"scopes":      []string{"admin:full"},
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytes))
		req.Header.Set("X-User-Name", "alice")
		req.Header.Set("X-User-Role", "editor") // editor does not have admin:full scope

		w := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(w, req)

		res := w.Result()
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", res.StatusCode)
		}
	})

	// 5. Test isolation: list and delete
	t.Run("List and Delete isolation", func(t *testing.T) {
		// First create a token for alice
		body := map[string]interface{}{
			"name":        "Alice Token",
			"expiry_days": 3,
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytes))
		req.Header.Set("X-User-Name", "alice")
		req.Header.Set("X-User-Role", "editor")

		w := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("failed to create alice's token")
		}

		var createdResp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &createdResp)
		tokenHash := createdResp["token_hash"].(string)

		// Create a token for bob
		bodyBob := map[string]interface{}{
			"name":        "Bob Token",
			"expiry_days": 3,
		}
		bodyBytesBob, _ := json.Marshal(bodyBob)
		reqBob := httptest.NewRequest("POST", "/api/v1/me/tokens", bytes.NewReader(bodyBytesBob))
		reqBob.Header.Set("X-User-Name", "bob")
		reqBob.Header.Set("X-User-Role", "editor")

		wBob := httptest.NewRecorder()
		srv.handleSelfServiceGenerateToken(wBob, reqBob)
		if wBob.Code != http.StatusOK {
			t.Fatalf("failed to create bob's token")
		}

		// Alice lists her tokens. She should see Alice Token, but not Bob Token.
		reqListAlice := httptest.NewRequest("GET", "/api/v1/me/tokens", nil)
		reqListAlice.Header.Set("X-User-Name", "alice")
		wListAlice := httptest.NewRecorder()
		srv.handleSelfServiceListTokens(wListAlice, reqListAlice)

		var aliceTokens []database.APIToken
		json.Unmarshal(wListAlice.Body.Bytes(), &aliceTokens)
		if len(aliceTokens) != 2 { // One from previous test + one from this test
			t.Fatalf("expected alice to see 2 tokens, got %d", len(aliceTokens))
		}
		for _, tok := range aliceTokens {
			if tok.OwnedBy != "alice" {
				t.Fatalf("alice listed token not owned by her: %+v", tok)
			}
		}

		// Bob tries to delete alice's token
		reqDeleteBob := httptest.NewRequest("DELETE", "/api/v1/me/tokens/"+tokenHash, nil)
		// Go's net/http standard library mux PathValue is set using Request's SetPathValue in Go 1.22+
		reqDeleteBob.SetPathValue("hash", tokenHash)
		reqDeleteBob.Header.Set("X-User-Name", "bob")

		wDeleteBob := httptest.NewRecorder()
		srv.handleSelfServiceDeleteToken(wDeleteBob, reqDeleteBob)
		if wDeleteBob.Code != http.StatusForbidden {
			t.Fatalf("expected Bob to receive 403 Forbidden when deleting Alice's token, got %d", wDeleteBob.Code)
		}

		// Alice deletes her own token
		reqDeleteAlice := httptest.NewRequest("DELETE", "/api/v1/me/tokens/"+tokenHash, nil)
		reqDeleteAlice.SetPathValue("hash", tokenHash)
		reqDeleteAlice.Header.Set("X-User-Name", "alice")

		wDeleteAlice := httptest.NewRecorder()
		srv.handleSelfServiceDeleteToken(wDeleteAlice, reqDeleteAlice)
		if wDeleteAlice.Code != http.StatusOK {
			t.Fatalf("expected Alice to successfully delete her own token, got %d", wDeleteAlice.Code)
		}
	})
}
