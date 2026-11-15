package server

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
	"github.com/golang-jwt/jwt/v5"
	"k6-bedrock-dashboard/backend/internal/database"
)

type oidcTestTransport func(*http.Request) (*http.Response, error)

func (f oidcTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Exercise discovery, PKCE exchange, JWKS signature validation and account binding
// without contacting an identity provider or opening a listening socket.
func TestOIDCSecurity(t *testing.T) {
	s, mux := securityServer(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const issuer = "https://oidc.example.test"
	if err = s.db.SaveSSOConfig(&database.SSOConfig{Enabled: true, IssuerURL: issuer, ClientID: "portal", ClientSecret: "dummy-client-secret", RedirectURI: "https://portal.example.test/login", AdminGroups: "platform-admins"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                           string
		change                         func(jwt.MapClaims)
		wrongKey, wrongState, noCookie bool
		want                           int
	}{
		{name: "valid", want: 200},
		{name: "wrong audience", change: func(c jwt.MapClaims) { c["aud"] = "other-app" }, want: 401},
		{name: "wrong issuer", change: func(c jwt.MapClaims) { c["iss"] = "https://other.example.test" }, want: 401},
		{name: "expired", change: func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }, want: 401},
		{name: "missing subject", change: func(c jwt.MapClaims) { delete(c, "sub") }, want: 401},
		{name: "wrong nonce", change: func(c jwt.MapClaims) { c["nonce"] = "unrelated" }, want: 401},
		{name: "wrong signature", wrongKey: true, want: 401},
		{name: "wrong state", wrongState: true, want: 400},
		{name: "missing flow cookie", noCookie: true, want: 400},
		{name: "local account collision", change: func(c jwt.MapClaims) { c["sub"] = "colliding-identity"; c["email"] = "admin" }, want: 403},
		{name: "unverified email cannot select an account", change: func(c jwt.MapClaims) {
			c["sub"] = "unverified-identity"
			c["email"] = "admin"
			c["email_verified"] = false
		}, want: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			nonce, challenge := "", ""
			exchanged := false
			client := &http.Client{Transport: oidcTestTransport(func(r *http.Request) (*http.Response, error) {
				var response interface{}
				switch r.URL.String() {
				case issuer + "/.well-known/openid-configuration":
					response = map[string]interface{}{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}}
				case issuer + "/keys":
					response = jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig"}}}
				case issuer + "/token":
					exchanged = true
					if err := r.ParseForm(); err != nil {
						t.Fatal(err)
					}
					verifier := r.Form.Get("code_verifier")
					digest := sha256.Sum256([]byte(verifier))
					if verifier == "" || base64.RawURLEncoding.EncodeToString(digest[:]) != challenge {
						t.Error("PKCE verifier does not match authorization challenge")
					}
					claims := jwt.MapClaims{"iss": issuer, "sub": "stable-subject", "aud": "portal", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": nonce, "email": "person@example.test", "email_verified": true, "groups": []string{"admin-notifications-readonly"}}
					if tc.change != nil {
						tc.change(claims)
					}
					signingKey := key
					if tc.wrongKey {
						signingKey = otherKey
					}
					token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
					token.Header["kid"] = "test-key"
					raw, err := token.SignedString(signingKey)
					if err != nil {
						t.Fatal(err)
					}
					response = map[string]interface{}{"access_token": "dummy-access-token", "token_type": "Bearer", "expires_in": 3600, "id_token": raw}
				default:
					t.Fatalf("unexpected outbound URL: %s", r.URL)
					return nil, nil
				}
				b, err := json.Marshal(response)
				if err != nil {
					t.Fatal(err)
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b))), Request: r}, nil
			})}
			begin := httptest.NewRequest("GET", "/api/auth/sso/url", nil)
			begin = begin.WithContext(oidc.ClientContext(begin.Context(), client))
			bw := httptest.NewRecorder()
			mux.ServeHTTP(bw, begin)
			if bw.Code != 200 {
				t.Fatalf("authorize: %d %s", bw.Code, bw.Body.String())
			}
			var result struct {
				URL string `json:"url"`
			}
			if err := json.Unmarshal(bw.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			authURL, err := url.Parse(result.URL)
			if err != nil {
				t.Fatal(err)
			}
			nonce = authURL.Query().Get("nonce")
			challenge = authURL.Query().Get("code_challenge")
			if nonce == "" || challenge == "" || authURL.Query().Get("code_challenge_method") != "S256" {
				t.Fatal("missing transaction protection")
			}
			state := authURL.Query().Get("state")
			if tc.wrongState {
				state = "other-state"
			}
			payload, _ := json.Marshal(map[string]string{"code": "test-code", "state": state})
			callback := httptest.NewRequest("POST", "/api/auth/sso/callback", strings.NewReader(string(payload)))
			callback = callback.WithContext(oidc.ClientContext(callback.Context(), client))
			if !tc.noCookie {
				for _, cookie := range bw.Result().Cookies() {
					if cookie.Name == oidcFlowCookie {
						if !cookie.Secure || !cookie.HttpOnly {
							t.Fatal("unsafe flow cookie")
						}
						callback.AddCookie(cookie)
					}
				}
			}
			cw := httptest.NewRecorder()
			mux.ServeHTTP(cw, callback)
			if cw.Code != tc.want {
				t.Fatalf("callback: %d want %d: %s", cw.Code, tc.want, cw.Body.String())
			}
			if (tc.noCookie || tc.wrongState) && exchanged {
				t.Error("invalid transaction contacted token endpoint")
			}
			sessionIssued := false
			for _, cookie := range cw.Result().Cookies() {
				if cookie.Name == "session_token" && cookie.Value != "" {
					sessionIssued = true
					if !cookie.HttpOnly || !cookie.Secure {
						t.Fatal("unsafe session cookie")
					}
				}
			}
			if sessionIssued != (tc.want == 200) {
				t.Fatal("unexpected session issuance")
			}
			if tc.want == 200 && (strings.Contains(cw.Body.String(), `"role":"administrator"`) || strings.Contains(cw.Body.String(), `"username":"admin"`)) {
				t.Fatal("unexpected account selection or privilege escalation")
			}
		})
	}
	admin, err := s.db.GetUser("admin")
	if err != nil || admin == nil || admin.PasswordHash == "" {
		t.Fatal("local account overwritten")
	}
}
