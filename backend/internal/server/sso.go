package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
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
	json.NewEncoder(w).Encode(c)
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

	if err := s.db.SaveSSOConfig(&body); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save sso config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(body)
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

type OpenIDConfig struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

func getOpenIDConfig(issuerURL string) (*OpenIDConfig, error) {
	wellKnown := strings.TrimSuffix(issuerURL, "/") + "/.well-known/openid-configuration"
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(wellKnown)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var cfg OpenIDConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Server) handleGetSSOAuthorizeURL(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil || !c.Enabled {
		http.Error(w, `{"error":"SSO not configured or disabled"}`, http.StatusBadRequest)
		return
	}

	oidcCfg, err := getOpenIDConfig(c.IssuerURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch OpenID metadata: %v"}`, err), http.StatusInternalServerError)
		return
	}

	state := fmt.Sprintf("%d", time.Now().UnixNano())
	authURL := fmt.Sprintf("%s?response_type=code&client_id=%s&redirect_uri=%s&scope=openid+profile+email&state=%s",
		oidcCfg.AuthorizationEndpoint,
		c.ClientID,
		c.RedirectURI,
		state,
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": authURL})
}

func (s *Server) handleSSOCallbackExchange(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	c, err := s.db.GetSSOConfig()
	if err != nil || !c.Enabled {
		http.Error(w, `{"error":"SSO disabled"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if body.Code == "" {
		http.Error(w, `{"error":"missing auth code"}`, http.StatusBadRequest)
		return
	}

	oidcCfg, err := getOpenIDConfig(c.IssuerURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get OIDC configuration: %v"}`, err), http.StatusInternalServerError)
		return
	}

	exchangeClient := &http.Client{Timeout: 10 * time.Second}
	data := fmt.Sprintf("grant_type=authorization_code&code=%s&client_id=%s&client_secret=%s&redirect_uri=%s",
		body.Code,
		c.ClientID,
		c.ClientSecret,
		c.RedirectURI,
	)
	req, err := http.NewRequest("POST", oidcCfg.TokenEndpoint, strings.NewReader(data))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to construct token request: %v"}`, err), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := exchangeClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to perform token exchange: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"token exchange failed with status %d"}`, resp.StatusCode), http.StatusBadRequest)
		return
	}

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to decode token response: %v"}`, err), http.StatusInternalServerError)
		return
	}

	profileReq, err := http.NewRequest("GET", oidcCfg.UserinfoEndpoint, nil)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to construct userinfo request: %v"}`, err), http.StatusInternalServerError)
		return
	}
	profileReq.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)

	profileResp, err := exchangeClient.Do(profileReq)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to fetch user info: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer profileResp.Body.Close()

	if profileResp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"userinfo request failed with status %d"}`, profileResp.StatusCode), http.StatusBadRequest)
		return
	}

	var userProfile struct {
		Name          string   `json:"name"`
		Email         string   `json:"email"`
		PreferredName string   `json:"preferred_username"`
		Groups        []string `json:"groups"`
	}
	if err := json.NewDecoder(profileResp.Body).Decode(&userProfile); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to decode user profile: %v"}`, err), http.StatusInternalServerError)
		return
	}

	username := userProfile.Email
	if username == "" {
		username = userProfile.PreferredName
	}
	if username == "" {
		username = userProfile.Name
	}

	if tokenResponse.IDToken != "" {
		parts := strings.Split(tokenResponse.IDToken, ".")
		if len(parts) >= 2 {
			payloadSegment := parts[1]
			if payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadSegment); err == nil {
				var idTokenClaims struct {
					Groups []string `json:"groups"`
				}
				if err := json.Unmarshal(payloadBytes, &idTokenClaims); err == nil {
					for _, newG := range idTokenClaims.Groups {
						exists := false
						for _, oldG := range userProfile.Groups {
							if oldG == newG {
								exists = true
								break
							}
						}
						if !exists {
							userProfile.Groups = append(userProfile.Groups, newG)
						}
					}
				}
			}
		}
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

	if s.db != nil {
		existingUser, err := s.db.GetUser(username)
		if err == nil {
			if existingUser == nil {
				newUser := &database.User{
					Username:     username,
					PasswordHash: "",
					Salt:         "sso_user",
					Role:         role,
					CreatedAt:    time.Now(),
				}
				_ = s.db.SaveUser(newUser)
			} else if existingUser.Role != role {
				existingUser.Role = role
				_ = s.db.SaveUser(existingUser)
			}
		}
		_ = s.db.SyncUserWorkspaceMembershipsFromGroups(username, userProfile.Groups)
	}

	sessionToken, err := s.authSvc.GenerateToken(username, role)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to generate session: %v"}`, err), http.StatusInternalServerError)
		return
	}
	s.setSessionCookie(w, sessionToken)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    sessionToken,
		"username": username,
		"role":     role,
	})
}
