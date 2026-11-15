package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"
)

func (s *Server) handleGetSSOConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get sso config: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(publicSSOConfig(c))
}

func (s *Server) handleSetSSOConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	var body database.SSOConfig
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.ClientSecret == "" {
		existing, err := s.db.GetSSOConfig()
		if err == nil && existing != nil && existing.ClientSecret != "" {
			body.ClientSecret = existing.ClientSecret
		}
	}

	if body.Enabled && (body.IssuerURL == "" || body.ClientID == "" || body.ClientSecret == "" || body.RedirectURI == "") {
		http.Error(w, `{"error":"all SSO fields are required when enabling"}`, http.StatusBadRequest)
		return
	}

	if body.Enabled && (!secureOIDCURL(body.IssuerURL) || !secureOIDCURL(body.RedirectURI)) {
		s.writeError(w, 400, "SSO issuer and redirect URI must use HTTPS")
		return
	}
	if err := s.db.SaveSSOConfig(&body); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save sso config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(publicSSOConfig(&body))
}

func (s *Server) handleGetSSOStatus(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"enabled":false}`))
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"enabled":false}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"enabled": c.Enabled, "name": c.Name})
}

const oidcFlowCookie = "__Host-stratos-oidc"

func secureOIDCURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Fragment == ""
}

func (s *Server) oidcProvider(ctx context.Context, c *database.SSOConfig) (*oidc.Provider, *oauth2.Config, error) {
	if !secureOIDCURL(c.IssuerURL) || !secureOIDCURL(c.RedirectURI) {
		return nil, nil, fmt.Errorf("SSO requires HTTPS issuer and redirect URI")
	}
	provider, err := oidc.NewProvider(ctx, c.IssuerURL)
	if err != nil {
		return nil, nil, err
	}
	var discovery struct {
		JWKSURL string `json:"jwks_uri"`
	}
	if err := provider.Claims(&discovery); err != nil || !secureOIDCURL(discovery.JWKSURL) {
		return nil, nil, fmt.Errorf("OIDC JWKS endpoint requires HTTPS")
	}
	endpoint := provider.Endpoint()
	if !secureOIDCURL(endpoint.AuthURL) || !secureOIDCURL(endpoint.TokenURL) {
		return nil, nil, fmt.Errorf("OIDC endpoints require HTTPS")
	}
	return provider, &oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: c.RedirectURI, Endpoint: endpoint, Scopes: []string{oidc.ScopeOpenID, "profile", "email"}}, nil
}

func randomOIDCValue() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Server) handleGetSSOAuthorizeURL(w http.ResponseWriter, r *http.Request) {
	c, err := s.db.GetSSOConfig()
	if err != nil || c == nil || !c.Enabled {
		s.writeError(w, 400, "SSO disabled")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	_, oauth, err := s.oidcProvider(ctx, c)
	if err != nil {
		s.writeError(w, 502, "failed to discover SSO provider")
		return
	}
	state, err := randomOIDCValue()
	if err != nil {
		s.writeError(w, 500, "failed to initialize SSO")
		return
	}
	nonce, err := randomOIDCValue()
	if err != nil {
		s.writeError(w, 500, "failed to initialize SSO")
		return
	}
	verifier := oauth2.GenerateVerifier()
	flow := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"aud": "stratos-oidc-flow", "exp": time.Now().Add(5 * time.Minute).Unix(),
		"state": state, "nonce": nonce, "verifier": verifier, "issuer": c.IssuerURL, "client": c.ClientID, "redirect": c.RedirectURI,
	})
	signed, err := flow.SignedString(s.config.JWTSecret)
	if err != nil {
		s.writeError(w, 500, "failed to initialize SSO")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oidcFlowCookie, Value: signed, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 300})
	w.Header().Set("Cache-Control", "no-store")
	s.writeJSON(w, 200, map[string]string{"url": oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier))})
}

func (s *Server) handleSSOCallbackExchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil || body.Code == "" || body.State == "" {
		s.writeError(w, 400, "missing SSO code or state")
		return
	}
	cookie, err := r.Cookie(oidcFlowCookie)
	if err != nil {
		s.writeError(w, 400, "missing SSO transaction")
		return
	}
	parsed, err := jwt.Parse(cookie.Value, func(t *jwt.Token) (interface{}, error) { return s.config.JWTSecret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithAudience("stratos-oidc-flow"))
	if err != nil || !parsed.Valid {
		s.writeError(w, 400, "invalid SSO transaction")
		return
	}
	claims := parsed.Claims.(jwt.MapClaims)
	value := func(key string) string { v, _ := claims[key].(string); return v }
	if value("state") == "" || subtle.ConstantTimeCompare([]byte(body.State), []byte(value("state"))) != 1 {
		s.writeError(w, 400, "invalid SSO state")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oidcFlowCookie, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	c, err := s.db.GetSSOConfig()
	if err != nil || c == nil || !c.Enabled || value("issuer") != c.IssuerURL || value("client") != c.ClientID || value("redirect") != c.RedirectURI {
		s.writeError(w, 400, "SSO configuration changed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	provider, oauth, err := s.oidcProvider(ctx, c)
	if err != nil {
		s.writeError(w, 502, "failed to discover SSO provider")
		return
	}
	token, err := oauth.Exchange(ctx, body.Code, oauth2.VerifierOption(value("verifier")))
	if err != nil {
		s.writeError(w, 401, "SSO exchange failed")
		return
	}
	rawID, _ := token.Extra("id_token").(string)
	idToken, err := provider.Verifier(&oidc.Config{ClientID: c.ClientID}).Verify(ctx, rawID)
	if err != nil || idToken.Subject == "" || value("nonce") == "" || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(value("nonce"))) != 1 {
		s.writeError(w, 401, "invalid SSO identity")
		return
	}
	var userProfile struct {
		Email         string   `json:"email"`
		EmailVerified bool     `json:"email_verified"`
		Groups        []string `json:"groups"`
	}
	if err := idToken.Claims(&userProfile); err != nil {
		s.writeError(w, 401, "invalid SSO claims")
		return
	}
	// Identity is bound to issuer+subject, never to a mutable display name.
	identityHash := sha256.Sum256([]byte(idToken.Issuer + "\x00" + idToken.Subject))
	username := "oidc:" + hex.EncodeToString(identityHash[:])
	if userProfile.EmailVerified && userProfile.Email != "" {
		username = userProfile.Email
	}
	adminGroupsConfig := c.AdminGroups
	editorGroupsConfig := c.EditorGroups

	adminGroupList := []string{}
	for _, g := range strings.Split(adminGroupsConfig, ",") {
		gTrimmed := strings.ToLower(strings.TrimSpace(g))
		if gTrimmed != "" {
			adminGroupList = append(adminGroupList, gTrimmed)
		}
	}
	editorGroupList := []string{}
	for _, g := range strings.Split(editorGroupsConfig, ",") {
		gTrimmed := strings.ToLower(strings.TrimSpace(g))
		if gTrimmed != "" {
			editorGroupList = append(editorGroupList, gTrimmed)
		}
	}

	// Role is derived ONLY from exact (case-insensitive) matches against
	// the administrator/editor group lists an admin configured in
	// Settings > SSO. Earlier versions of this handler also granted
	// "administrator" to any group or username merely *containing* the
	// substring "admin" (e.g. a group named "admin-notifications-readonly"
	// or a user "radmin.jones") — that was a privilege-escalation bug, not
	// a convenience fallback, and has been removed. If no groups match,
	// the user is provisioned as a viewer and an administrator must
	// explicitly elevate them.
	role := "viewer"
	hasAdminGroup := false
	hasEditorGroup := false

	for _, g := range userProfile.Groups {
		gLower := strings.ToLower(strings.TrimSpace(g))

		for _, adminG := range adminGroupList {
			if gLower == adminG {
				hasAdminGroup = true
			}
		}
		for _, editorG := range editorGroupList {
			if gLower == editorG {
				hasEditorGroup = true
			}
		}
	}

	if hasAdminGroup {
		role = "administrator"
	} else if hasEditorGroup {
		role = "editor"
	}

	identity := "oidc:" + hex.EncodeToString(identityHash[:])
	existing, err := s.db.GetUserBySSOIdentity(identity)
	if err != nil {
		s.writeError(w, 500, "failed to load identity")
		return
	}
	if existing != nil {
		username = existing.Username
	} else {
		existing, err = s.db.GetUser(username)
		if err != nil {
			s.writeError(w, 500, "failed to load account")
			return
		}
		if existing != nil && (existing.Salt != "sso_user" || !userProfile.EmailVerified || username != userProfile.Email) {
			s.writeError(w, 403, "SSO identity conflicts with an existing account")
			return
		}
	}
	if existing == nil {
		existing = &database.User{Username: username, CreatedAt: time.Now()}
	}
	existing.Salt, existing.PasswordHash, existing.Role = identity, "", role
	if err := s.db.SaveSSOUser(existing); err != nil {
		s.writeError(w, 500, "failed to save account")
		return
	}
	if err := s.db.SyncUserWorkspaceMembershipsFromGroups(username, userProfile.Groups); err != nil {
		s.writeError(w, 500, "failed to sync memberships")
		return
	}
	sessionToken, err := s.authSvc.GenerateToken(username, role)
	if err != nil {
		s.writeError(w, 500, "failed to create session")
		return
	}
	s.setSessionCookie(w, sessionToken)
	s.writeJSON(w, 200, map[string]string{"username": username, "role": role})
}
