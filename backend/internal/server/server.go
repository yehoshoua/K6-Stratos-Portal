package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"k6-bedrock-dashboard/backend/internal/auth"
	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/guardian"
	"k6-bedrock-dashboard/backend/internal/influx"
	"k6-bedrock-dashboard/backend/internal/k8s"
)

type ClusterConfig = database.ClusterConfig

type Server struct {
	config        *config.Config
	authSvc       *auth.AuthService
	influxSvc     *influx.MetricsService
	db            *database.DB
	clientCache   map[string]*k8s.EKSClusterClient
	clientCacheMu sync.RWMutex

	guardianCoordinator *guardian.Coordinator
	guardianBus         *guardianEventBus

	loginLimiter *rateLimiter

	k8sVersionCache *ttlCache[string]
	operatorCache   *ttlCache[bool]
}

func NewServer(cfg *config.Config, db *database.DB) *Server {
	authSvc := auth.NewAuthService(cfg.JWTSecret, db)

	var active *database.InfluxConfig
	if cfg.InfluxURL != "" {
		active = &database.InfluxConfig{
			ID:        "influx-env",
			Name:      "Environment Config",
			Version:   "v2",
			URL:       cfg.InfluxURL,
			Token:     cfg.InfluxToken,
			Org:       cfg.InfluxOrg,
			Bucket:    cfg.InfluxBucket,
			Method:    "POST",
			IsActive:  true,
			CreatedAt: time.Now(),
		}
	} else if db != nil {
		var err error
		active, err = db.GetActiveInfluxConfig()
		if err != nil {
			log.Printf("Warning: failed to query active InfluxDB config: %v", err)
		}

		if active == nil {
			// Migrate legacy single settings from settings table if present
			legacyURL, _ := db.GetSetting("influx_url")
			if legacyURL != "" {
				legacyVersion, _ := db.GetSetting("influx_version")
				if legacyVersion == "" {
					legacyVersion = "v2"
				}
				legacyToken, _ := db.GetSetting("influx_token")
				legacyOrg, _ := db.GetSetting("influx_org")
				legacyBucket, _ := db.GetSetting("influx_bucket")
				legacyUsername, _ := db.GetSetting("influx_username")
				legacyPassword, _ := db.GetSetting("influx_password")
				legacyMethod, _ := db.GetSetting("influx_method")
				if legacyMethod == "" {
					legacyMethod = "POST"
				}

				active = &database.InfluxConfig{
					ID:        "influx-default",
					Name:      "Default InfluxDB",
					Version:   legacyVersion,
					URL:       legacyURL,
					Token:     legacyToken,
					Org:       legacyOrg,
					Bucket:    legacyBucket,
					Username:  legacyUsername,
					Password:  legacyPassword,
					Method:    legacyMethod,
					IsActive:  true,
					CreatedAt: time.Now(),
				}

				if err := db.SaveInfluxConfig(active); err == nil {
					_ = db.SetActiveInfluxConfig(active.ID)
					log.Printf("Migrated legacy InfluxDB config into new multi-server table under ID: %s", active.ID)
				}
			}
		}
	}

	versionVal := "v2"
	urlVal := cfg.InfluxURL
	tokenVal := cfg.InfluxToken
	orgVal := cfg.InfluxOrg
	bucketVal := cfg.InfluxBucket
	usernameVal := ""
	passwordVal := ""
	methodVal := "POST"

	if active != nil {
		versionVal = active.Version
		urlVal = active.URL
		tokenVal = active.Token
		orgVal = active.Org
		bucketVal = active.Bucket
		usernameVal = active.Username
		passwordVal = active.Password
		methodVal = active.Method

		cfg.InfluxURL = active.URL
		cfg.InfluxToken = active.Token
		cfg.InfluxOrg = active.Org
		cfg.InfluxBucket = active.Bucket
	}

	var influxSvc *influx.MetricsService
	if urlVal != "" {
		influxSvc = influx.NewMetricsService(versionVal, urlVal, tokenVal, orgVal, bucketVal, usernameVal, passwordVal, methodVal)
	} else {
		// Initialize empty MetricsService without mock configs
		influxSvc = influx.NewMetricsService("v2", "", "", "", "", "", "", "POST")
	}

	s := &Server{
		config:              cfg,
		authSvc:             authSvc,
		influxSvc:           influxSvc,
		db:                  db,
		clientCache:         make(map[string]*k8s.EKSClusterClient),
		guardianCoordinator: newGuardianCoordinator(cfg),
		guardianBus:         newGuardianEventBus(),
		loginLimiter:        newRateLimiter(10, time.Minute),
		k8sVersionCache:     newTTLCache[string](5 * time.Minute),
		operatorCache:       newTTLCache[bool](2 * time.Minute),
	}

	return s
}

// audit writes a best-effort, never-fatal record of a security-relevant
// action to the audit_logs table. Failures are logged but never bubble up
// to the caller — auditing must not be able to break the platform.

func (s *Server) audit(action, actor, target string, metadata map[string]interface{}) {
	if s.db == nil {
		return
	}
	metaJSON := "{}"
	if metadata != nil {
		if b, err := json.Marshal(metadata); err == nil {
			metaJSON = string(b)
		}
	}
	entry := &database.AuditLog{
		Action:    action,
		Actor:     actor,
		Target:    target,
		Metadata:  metaJSON,
		CreatedAt: time.Now(),
	}
	if err := s.db.WriteAuditLog(entry); err != nil {
		log.Printf("audit: failed to write log entry for action %q: %v", action, err)
	}
}

// Start launches the HTTP server

func (s *Server) Start() error {
	mux := http.NewServeMux()
	s.registerRoutes(mux)

	// Wrap in CORS middleware
	handler := s.corsMiddleware(mux)

	log.Printf("Server listening on port %s", s.config.Port)
	return http.ListenAndServe(":"+s.config.Port, handler)
}

// RegisterRoutes exposes registerRoutes to cmd/api/main.go, which needs
// to build its own *http.Server so it can run the HTTP listener
// alongside (not blocked by) the leader-election loop.

func (s *Server) RegisterRoutes(mux *http.ServeMux) { s.registerRoutes(mux) }

// WithCORS exposes corsMiddleware to cmd/api/main.go for the same reason.

func (s *Server) WithCORS(next http.Handler) http.Handler { return s.corsMiddleware(next) }

// registerRoutes wires every HTTP route onto mux. Split out from Start so
// that leader-election wiring in cmd/api/main.go can register routes
// without also (re)starting the blocking HTTP listener.

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Health probes (unauthenticated, per backend-ha-leader-election.mdc)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleReadyz)

	// Auth routes
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/sso", s.handleSSO)
	mux.HandleFunc("GET /api/auth/me", s.authMiddleware(s.handleMe))

	// K8s Clusters routes (read public, write admin-only)
	mux.HandleFunc("GET /api/k8s/clusters", s.authMiddleware(s.handleListClusters))
	mux.HandleFunc("POST /api/k8s/clusters", s.authMiddleware(s.adminOnly(s.handleRegisterCluster)))
	mux.HandleFunc("PUT /api/k8s/clusters/{id}", s.authMiddleware(s.adminOnly(s.handleUpdateCluster)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}", s.authMiddleware(s.adminOnly(s.handleDeleteCluster)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/namespaces", s.authMiddleware(s.handleListNamespaces))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/addons", s.authMiddleware(s.handleGetClusterAddons))

	// AWS EKS Discovery endpoints
	mux.HandleFunc("GET /api/settings/eks-discovery", s.authMiddleware(s.adminOnly(s.handleGetEKSDiscoveryConfig)))
	mux.HandleFunc("POST /api/settings/eks-discovery/discover", s.authMiddleware(s.adminOnly(s.handleDiscoverEKSClusters)))
	mux.HandleFunc("POST /api/settings/eks-discovery/sync", s.authMiddleware(s.adminOnly(s.handleSyncDiscoveredEKSClusters)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/ecr/check", s.authMiddleware(s.handleCheckECRRepo))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/resolve-image", s.authMiddleware(s.handleResolveClusterImage))
	mux.HandleFunc("GET /api/k8s/local-contexts", s.authMiddleware(s.adminOnly(s.handleListLocalContexts)))
	mux.HandleFunc("GET /api/k8s/operator-status", s.authMiddleware(s.handleGetOperatorStatus))
	mux.HandleFunc("GET /api/k8s/active-tests", s.authMiddleware(s.handleGetActiveTests))

	// Settings routes (admin only)
	mux.HandleFunc("GET /api/settings/influxdb", s.authMiddleware(s.adminOnly(s.handleGetInfluxDBConfig)))
	mux.HandleFunc("POST /api/settings/influxdb", s.authMiddleware(s.adminOnly(s.handleSetInfluxDBConfig)))
	mux.HandleFunc("POST /api/settings/influxdb/test", s.authMiddleware(s.adminOnly(s.handleTestInfluxDBConfig)))
	mux.HandleFunc("GET /api/settings/influxdb/servers", s.authMiddleware(s.handleListInfluxServers))
	mux.HandleFunc("POST /api/settings/influxdb/servers", s.authMiddleware(s.adminOnly(s.handleCreateInfluxServer)))
	mux.HandleFunc("PUT /api/settings/influxdb/servers/{id}", s.authMiddleware(s.adminOnly(s.handleUpdateInfluxServer)))
	mux.HandleFunc("DELETE /api/settings/influxdb/servers/{id}", s.authMiddleware(s.adminOnly(s.handleDeleteInfluxServer)))
	mux.HandleFunc("POST /api/settings/influxdb/servers/{id}/activate", s.authMiddleware(s.handleActivateInfluxServer))

	// Settings User Management routes (admin only)
	mux.HandleFunc("GET /api/settings/users", s.authMiddleware(s.adminOnly(s.handleListUsers)))
	mux.HandleFunc("POST /api/settings/users", s.authMiddleware(s.adminOnly(s.handleCreateUser)))
	mux.HandleFunc("DELETE /api/settings/users/{username}", s.authMiddleware(s.adminOnly(s.handleDeleteUser)))

	// Settings SSO/OIDC routes
	mux.HandleFunc("GET /api/settings/sso", s.authMiddleware(s.adminOnly(s.handleGetSSOConfig)))
	mux.HandleFunc("POST /api/settings/sso", s.authMiddleware(s.adminOnly(s.handleSetSSOConfig)))
	mux.HandleFunc("GET /api/auth/sso/status", s.handleGetSSOStatus)
	mux.HandleFunc("GET /api/auth/sso/url", s.handleGetSSOAuthorizeURL)
	mux.HandleFunc("POST /api/auth/sso/callback", s.handleSSOCallbackExchange)

	// K6 Run Template routes
	mux.HandleFunc("GET /api/settings/templates", s.authMiddleware(s.handleListTemplates))
	mux.HandleFunc("POST /api/settings/templates", s.authMiddleware(s.editorOrAdmin(s.handleCreateTemplate)))
	mux.HandleFunc("PUT /api/settings/templates/{id}", s.authMiddleware(s.editorOrAdmin(s.handleUpdateTemplate)))
	mux.HandleFunc("DELETE /api/settings/templates/{id}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteTemplate)))

	// Run defaults routes (editor+)
	mux.HandleFunc("GET /api/settings/defaults", s.authMiddleware(s.handleGetRunDefaults))
	mux.HandleFunc("POST /api/settings/defaults", s.authMiddleware(s.editorOrAdmin(s.handleSaveRunDefaults)))

	// API Tokens management routes (admin only)
	mux.HandleFunc("GET /api/settings/tokens", s.authMiddleware(s.adminOnly(s.handleListAPITokens)))
	mux.HandleFunc("POST /api/settings/tokens", s.authMiddleware(s.adminOnly(s.handleGenerateAPIToken)))
	mux.HandleFunc("DELETE /api/settings/tokens/{hash}", s.authMiddleware(s.adminOnly(s.handleDeleteAPIToken)))

	// Self-service personal token routes (all authenticated users, capped at 7 days)
	mux.HandleFunc("GET /api/v1/me/tokens", s.authMiddleware(s.handleSelfServiceListTokens))
	mux.HandleFunc("POST /api/v1/me/tokens", s.authMiddleware(s.handleSelfServiceGenerateToken))
	mux.HandleFunc("DELETE /api/v1/me/tokens/{hash}", s.authMiddleware(s.handleSelfServiceDeleteToken))

	// K6 CRD observability routes
	mux.HandleFunc("GET /api/k8s/clusters/{id}/crds", s.authMiddleware(s.handleListCRDs))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/crds", s.authMiddleware(s.editorOrAdmin(s.handleCreateCRD)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}/crds/{name}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteCRD)))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/crds/{name}/relaunch", s.authMiddleware(s.editorOrAdmin(s.handleRelaunchCRD)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/batch-workloads", s.authMiddleware(s.handleListBatchWorkloads))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/batch-workloads/cronjobs/{name}/toggle", s.authMiddleware(s.editorOrAdmin(s.handleToggleBatchCronJob)))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.handleGetConfigMap))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/configmaps", s.authMiddleware(s.handleListConfigMaps))
	mux.HandleFunc("PUT /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.editorOrAdmin(s.handleUpdateConfigMap)))
	mux.HandleFunc("DELETE /api/k8s/clusters/{id}/configmaps/{name}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteConfigMap)))
	mux.HandleFunc("POST /api/k8s/clusters/{id}/configmaps", s.authMiddleware(s.editorOrAdmin(s.handleCreateConfigMap)))

	// InfluxDB telemetry routes
	mux.HandleFunc("GET /api/influx/status", s.authMiddleware(s.handleInfluxStatus))
	mux.HandleFunc("GET /api/influx/runs", s.authMiddleware(s.handleListTestRuns))
	mux.HandleFunc("GET /api/influx/runs/{run_id}/metrics", s.authMiddleware(s.handleGetRunMetrics))
	mux.HandleFunc("GET /api/influx/runs/{run_id}/stream", s.authMiddleware(s.handleStreamRunMetrics))
	mux.HandleFunc("GET /api/influx/alerts", s.authMiddleware(s.handleListAlerts))

	// Pod log streaming route
	mux.HandleFunc("GET /api/k8s/clusters/{id}/pods", s.authMiddleware(s.handleListPods))
	mux.HandleFunc("GET /api/k8s/clusters/{id}/pods/{pod_name}/logs", s.authMiddleware(s.handleGetPodLogs))

	// Schedules routes
	mux.HandleFunc("GET /api/settings/schedules", s.authMiddleware(s.handleListSchedules))
	mux.HandleFunc("POST /api/settings/schedules", s.authMiddleware(s.editorOrAdmin(s.handleCreateSchedule)))
	mux.HandleFunc("PUT /api/settings/schedules/{id}", s.authMiddleware(s.editorOrAdmin(s.handleUpdateSchedule)))
	mux.HandleFunc("DELETE /api/settings/schedules/{id}", s.authMiddleware(s.editorOrAdmin(s.handleDeleteSchedule)))
	mux.HandleFunc("POST /api/settings/schedules/{id}/run", s.authMiddleware(s.editorOrAdmin(s.handleRunSchedule)))
	mux.HandleFunc("POST /api/settings/schedules/{id}/toggle", s.authMiddleware(s.editorOrAdmin(s.handleToggleSchedule)))

	// Guardian multi-agent validation runtime
	mux.HandleFunc("POST /api/v1/guardian/validate", s.authMiddleware(s.handleGuardianValidate))
	mux.HandleFunc("GET /api/v1/guardian/runs", s.authMiddleware(s.handleGuardianListRuns))
	mux.HandleFunc("GET /api/v1/guardian/runs/{id}", s.authMiddleware(s.handleGuardianGetRun))
	mux.HandleFunc("GET /api/v1/guardian/runs/{id}/stream", s.authMiddleware(s.handleGuardianStream))
	mux.HandleFunc("POST /api/v1/guardian/runs/{id}/override", s.authMiddleware(s.adminOnly(s.handleGuardianOverride)))
	mux.HandleFunc("GET /api/v1/guardian/policies", s.authMiddleware(s.adminOnly(s.handleListGuardianPolicies)))
	mux.HandleFunc("PUT /api/v1/guardian/policies/{id}", s.authMiddleware(s.adminOnly(s.handleUpsertGuardianPolicy)))

	// Audit trail (security_auditor or administrator)
	mux.HandleFunc("GET /api/v1/audit-logs", s.authMiddleware(s.auditorOrAdmin(s.handleListAuditLogs)))

	// User scopes (ABAC) — administrator manages, users can read their own
	mux.HandleFunc("GET /api/v1/users/{username}/scopes", s.authMiddleware(s.handleGetUserScopes))
	mux.HandleFunc("POST /api/v1/users/{username}/scopes", s.authMiddleware(s.adminOnly(s.handleAddUserScope)))
	mux.HandleFunc("DELETE /api/v1/users/{username}/scopes/{scopeId}", s.authMiddleware(s.adminOnly(s.handleDeleteUserScope)))

	// Fleet-wide dashboard summary (parallelized across registered clusters)
	mux.HandleFunc("GET /api/v1/fleet/summary", s.authMiddleware(s.handleFleetSummary))
}

// corsMiddleware sets up CORS headers for development/production

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The browser normally reaches this API through the same-origin Next.js
		// proxy. Only explicitly configured origins may call it cross-origin.
		origin := r.Header.Get("Origin")
		if allowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS"); origin != "" && allowedOrigins != "" {
			for _, allowed := range strings.Split(allowedOrigins, ",") {
				if strings.TrimSpace(allowed) == origin {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					break
				}
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    token,
		Path:     "/",
		MaxAge:   int((24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

// handleHealthz is a liveness probe: the process is up and serving HTTP.

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

// handleReadyz is a readiness probe: the process is up AND its database
// connection is actually usable. Per backend-ha-leader-election.mdc, load
// balancers should stop routing traffic to a replica that fails this.

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if s.db != nil {
		if err := s.db.Ping(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("database unreachable"))
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ready"))
}

// authMiddleware secures routes using JWT or API Tokens

func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		var tokenStr string
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		} else if session, err := r.Cookie("session_token"); err == nil && session.Value != "" {
			tokenStr = session.Value
		} else {
			http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
			return
		}

		var username, role, scopes string

		if strings.HasPrefix(tokenStr, "stratum_tok_") {
			// Validate API Token
			hasher := sha256.New()
			hasher.Write([]byte(tokenStr))
			tokenHash := hex.EncodeToString(hasher.Sum(nil))

			tok, err := s.db.GetAPITokenByHash(tokenHash)
			if err != nil || tok == nil {
				http.Error(w, `{"error":"invalid API token"}`, http.StatusUnauthorized)
				return
			}

			if tok.ExpiresAt != nil && tok.ExpiresAt.Before(time.Now()) {
				http.Error(w, `{"error":"expired API token"}`, http.StatusUnauthorized)
				return
			}

			username = "api-token:" + tok.Name
			role = tok.Role
			scopes = tok.Scopes
			if scopes == "" {
				// Default scopes backfilled for legacy database tokens
				scopes = scopesForRole(role)
			}
		} else {
			// Validate JWT User Token
			var err error
			username, role, err = s.authSvc.ValidateToken(tokenStr)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusUnauthorized)
				return
			}
			// Map interactive session roles to virtual scopes
			scopes = scopesForRole(role)
		}

		// Inject user info into headers/context
		r.Header.Set("X-User-Name", username)
		r.Header.Set("X-User-Role", role)
		r.Header.Set("X-User-Scopes", scopes)

		next.ServeHTTP(w, r)
	}
}

// adminOnly secures endpoints requiring administrator privileges

func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-User-Role")
		scopes := r.Header.Get("X-User-Scopes")
		hasAdminScope := hasScope(scopes, "admin:full")
		if !hasAdminScope && role != "administrator" && role != "admin" {
			http.Error(w, `{"error":"forbidden: administrator role or admin:full scope required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// editorOrAdmin secures endpoints requiring editor or administrator privileges

func (s *Server) editorOrAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-User-Role")
		scopes := r.Header.Get("X-User-Scopes")
		hasRequiredScope := hasScope(scopes, "admin:full") ||
			hasScope(scopes, "tests:create") ||
			hasScope(scopes, "tests:update") ||
			hasScope(scopes, "tests:launch") ||
			hasScope(scopes, "schedules:create")
		hasAllowedRole := role == "administrator" || role == "admin" || role == "editor" || role == "edit"
		if !hasRequiredScope && !hasAllowedRole {
			http.Error(w, `{"error":"forbidden: editor/admin role or write scope required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// auditorOrAdmin secures read-only compliance endpoints (audit trail,
// Guardian history) for the security_auditor role introduced alongside
// Guardian, in addition to administrators.

func (s *Server) auditorOrAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-User-Role")
		scopes := r.Header.Get("X-User-Scopes")
		allowed := role == "administrator" || role == "admin" || role == RoleSecurityAuditor ||
			hasScope(scopes, "admin:full") || hasScope(scopes, "audit:read")
		if !allowed {
			http.Error(w, `{"error":"forbidden: security_auditor or administrator role required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// --- Handler Implementations ---

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if s.loginLimiter != nil && !s.loginLimiter.Allow(ip) {
		s.audit("auth.login.rate_limited", ip, "", nil)
		http.Error(w, `{"error":"too many login attempts, please try again later"}`, http.StatusTooManyRequests)
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	token, role, err := s.authSvc.LoginLocal(body.Username, body.Password)
	if err != nil {
		s.audit("auth.login.failed", body.Username, "", map[string]interface{}{"ip": ip})
		http.Error(w, `{"error":"invalid username or password"}`, http.StatusUnauthorized)
		return
	}
	s.audit("auth.login.success", body.Username, "", map[string]interface{}{"ip": ip})
	s.setSessionCookie(w, token)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    token,
		"username": body.Username,
		"role":     role,
	})
}

func (s *Server) handleSSO(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User  string `json:"user"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	token, role, err := s.authSvc.HandleSSOCallback(body.User, body.Email)
	if err != nil {
		http.Error(w, `{"error":"SSO authentication failed"}`, http.StatusInternalServerError)
		return
	}
	s.setSessionCookie(w, token)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token":    token,
		"username": body.User,
		"role":     role,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"username": r.Header.Get("X-User-Name"),
		"role":     r.Header.Get("X-User-Role"),
	})
}

func (s *Server) handleListTestRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.influxSvc.ListTestRuns(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

func (s *Server) handleInfluxStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"configured": s.influxSvc.Configured()})
}

func (s *Server) checkSLATemplate(runID string) *database.K6Template {
	templates, err := s.db.GetTemplates()
	if err != nil {
		return nil
	}
	for _, t := range templates {
		if strings.Contains(runID, t.ScriptName) || strings.Contains(runID, t.Name) {
			return t
		}
	}
	return nil
}

func (s *Server) handleGetRunMetrics(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	metric := r.URL.Query().Get("metric") // e.g. "vus", "http_req_duration"
	if metric == "" {
		metric = "http_req_duration"
	}
	duration := r.URL.Query().Get("range")
	if duration == "" {
		duration = "1h"
	}
	start := r.URL.Query().Get("start")
	stop := r.URL.Query().Get("stop")
	cluster := r.URL.Query().Get("cluster")
	namespace := r.URL.Query().Get("namespace")

	w.Header().Set("Content-Type", "application/json")

	if s.config.InfluxURL == "" {
		http.Error(w, `{"error":"InfluxDB not configured"}`, http.StatusBadRequest)
		return
	}

	points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, duration, start, stop, cluster, namespace)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to query metrics: %v"}`, err), http.StatusInternalServerError)
		return
	}

	// Check SLA thresholds in background
	go func(runID string, m string, pts []influx.TestMetricPoint) {
		tmpl := s.checkSLATemplate(runID)
		if tmpl == nil || tmpl.SLAThresholds == "" {
			return
		}
		var thresholds []struct {
			Metric   string  `json:"metric"`
			Operator string  `json:"operator"` // ">" or "<"
			Value    float64 `json:"value"`
		}
		if err := json.Unmarshal([]byte(tmpl.SLAThresholds), &thresholds); err != nil {
			return
		}

		for _, pt := range pts {
			for _, th := range thresholds {
				if th.Metric == m {
					violated := false
					if th.Operator == ">" && pt.Value > th.Value {
						violated = true
					} else if th.Operator == "<" && pt.Value < th.Value {
						violated = true
					}
					if violated {
						alert := &database.TestAlert{
							TestRunID: runID,
							Metric:    m,
							Threshold: fmt.Sprintf("%s %s %v", m, th.Operator, th.Value),
							Value:     pt.Value,
							Timestamp: pt.Timestamp,
						}
						_ = s.db.SaveAlert(alert)
					}
				}
			}
		}
	}(runID, metric, points)

	json.NewEncoder(w).Encode(points)
}

// --- Dynamic Mock Data Generation ---

func (s *Server) handleGetInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if os.Getenv("INFLUXDB_URL") != "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":          "influx-env",
			"name":        "Environment Config",
			"version":     "v2",
			"url":         s.config.InfluxURL,
			"token":       s.config.InfluxToken,
			"org":         s.config.InfluxOrg,
			"bucket":      s.config.InfluxBucket,
			"username":    "",
			"password":    "",
			"method":      "POST",
			"is_active":   true,
			"env_defined": true,
		})
		return
	}

	if s.db != nil {
		active, err := s.db.GetActiveInfluxConfig()
		if err == nil && active != nil {
			// convert to map to add env_defined field
			m := map[string]interface{}{
				"id":          active.ID,
				"name":        active.Name,
				"version":     active.Version,
				"url":         active.URL,
				"token":       active.Token,
				"org":         active.Org,
				"bucket":      active.Bucket,
				"username":    active.Username,
				"password":    active.Password,
				"method":      active.Method,
				"is_active":   active.IsActive,
				"env_defined": false,
			}
			json.NewEncoder(w).Encode(m)
			return
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"version":     "v2",
		"url":         "",
		"token":       "",
		"org":         "",
		"bucket":      "",
		"username":    "",
		"password":    "",
		"method":      "POST",
		"env_defined": false,
	})
}

func (s *Server) handleSetInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version  string `json:"version"` // "v1" or "v2"
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"` // "GET" or "POST"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.URL == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	// Verify connection before saving (warn but do not block)
	var warningMsg string
	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		warningMsg = fmt.Sprintf("Connection check failed: %v", err)
	}

	// Persist to settings table (legacy support)
	if s.db != nil {
		_ = s.db.SaveSetting("influx_version", body.Version)
		_ = s.db.SaveSetting("influx_url", body.URL)
		_ = s.db.SaveSetting("influx_token", body.Token)
		_ = s.db.SaveSetting("influx_org", body.Org)
		_ = s.db.SaveSetting("influx_bucket", body.Bucket)
		_ = s.db.SaveSetting("influx_username", body.Username)
		_ = s.db.SaveSetting("influx_password", body.Password)
		_ = s.db.SaveSetting("influx_method", body.Method)

		// Create/Update "Default InfluxDB" configuration in named table as active
		active := &database.InfluxConfig{
			ID:        "influx-default",
			Name:      "Default InfluxDB",
			Version:   body.Version,
			URL:       body.URL,
			Token:     body.Token,
			Org:       body.Org,
			Bucket:    body.Bucket,
			Username:  body.Username,
			Password:  body.Password,
			Method:    body.Method,
			IsActive:  true,
			CreatedAt: time.Now(),
		}
		_ = s.db.SaveInfluxConfig(active)
		_ = s.db.SetActiveInfluxConfig(active.ID)
	}

	s.config.InfluxURL = body.URL
	s.config.InfluxToken = body.Token
	s.config.InfluxOrg = body.Org
	s.config.InfluxBucket = body.Bucket

	// Reinitialize InfluxDB service client
	s.influxSvc.Close()
	s.influxSvc = influx.NewMetricsService(body.Version, body.URL, body.Token, body.Org, body.Bucket, body.Username, body.Password, body.Method)

	w.Header().Set("Content-Type", "application/json")
	if warningMsg != "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"warning": warningMsg,
		})
	} else {
		w.Write([]byte(`{"success":true}`))
	}
}

func (s *Server) handleTestInfluxDBConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version  string `json:"version"` // "v1" or "v2"
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"` // "GET" or "POST"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.URL == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListInfluxServers(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	list, err := s.db.GetInfluxConfigs()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get influx configs: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Version  string `json:"version"`
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.URL == "" || body.Bucket == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	if body.Version == "" {
		body.Version = "v2"
	}
	if body.Method == "" {
		body.Method = "POST"
	}

	// Verify connection first
	err := influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("influx-%d", time.Now().UnixNano())
	newConfig := &database.InfluxConfig{
		ID:        id,
		Name:      body.Name,
		Version:   body.Version,
		URL:       body.URL,
		Token:     body.Token,
		Org:       body.Org,
		Bucket:    body.Bucket,
		Username:  body.Username,
		Password:  body.Password,
		Method:    body.Method,
		IsActive:  false,
		CreatedAt: time.Now(),
	}

	list, _ := s.db.GetInfluxConfigs()
	if len(list) == 0 {
		newConfig.IsActive = true
	}

	if err := s.db.SaveInfluxConfig(newConfig); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save server config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if newConfig.IsActive {
		_ = s.db.SetActiveInfluxConfig(newConfig.ID)
		s.influxSvc.Close()
		s.influxSvc = influx.NewMetricsService(newConfig.Version, newConfig.URL, newConfig.Token, newConfig.Org, newConfig.Bucket, newConfig.Username, newConfig.Password, newConfig.Method)

		s.config.InfluxURL = newConfig.URL
		s.config.InfluxToken = newConfig.Token
		s.config.InfluxOrg = newConfig.Org
		s.config.InfluxBucket = newConfig.Bucket
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newConfig)
}

func (s *Server) handleUpdateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Version  string `json:"version"`
		URL      string `json:"url"`
		Token    string `json:"token"`
		Org      string `json:"org"`
		Bucket   string `json:"bucket"`
		Username string `json:"username"`
		Password string `json:"password"`
		Method   string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if body.Name == "" || body.URL == "" || body.Bucket == "" {
		http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
		return
	}

	list, err := s.db.GetInfluxConfigs()
	if err != nil {
		http.Error(w, `{"error":"failed to check configs"}`, http.StatusInternalServerError)
		return
	}
	var existing *database.InfluxConfig
	for _, item := range list {
		if item.ID == id {
			existing = item
			break
		}
	}
	if existing == nil {
		http.Error(w, `{"error":"server configuration not found"}`, http.StatusNotFound)
		return
	}

	err = influx.VerifyInfluxDBConnection(body.URL, body.Version, body.Token, body.Username, body.Password, body.Method)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Connection check failed: %v"}`, err), http.StatusBadRequest)
		return
	}

	updated := &database.InfluxConfig{
		ID:        id,
		Name:      body.Name,
		Version:   body.Version,
		URL:       body.URL,
		Token:     body.Token,
		Org:       body.Org,
		Bucket:    body.Bucket,
		Username:  body.Username,
		Password:  body.Password,
		Method:    body.Method,
		IsActive:  existing.IsActive,
		CreatedAt: existing.CreatedAt,
	}

	if err := s.db.SaveInfluxConfig(updated); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save server config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if updated.IsActive {
		s.influxSvc.Close()
		s.influxSvc = influx.NewMetricsService(updated.Version, updated.URL, updated.Token, updated.Org, updated.Bucket, updated.Username, updated.Password, updated.Method)

		s.config.InfluxURL = updated.URL
		s.config.InfluxToken = updated.Token
		s.config.InfluxOrg = updated.Org
		s.config.InfluxBucket = updated.Bucket
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (s *Server) handleDeleteInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	list, _ := s.db.GetInfluxConfigs()
	var toDelete *database.InfluxConfig
	for _, item := range list {
		if item.ID == id {
			toDelete = item
			break
		}
	}

	if toDelete == nil {
		http.Error(w, `{"error":"server configuration not found"}`, http.StatusNotFound)
		return
	}

	if err := s.db.DeleteInfluxConfig(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if toDelete.IsActive {
		if s.influxSvc != nil {
			s.influxSvc.Close()
		}
		s.influxSvc = influx.NewMetricsService("v2", "", "", "", "", "", "", "POST")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleActivateInfluxServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.SetActiveInfluxConfig(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to activate config: %v"}`, err), http.StatusInternalServerError)
		return
	}

	active, err := s.db.GetActiveInfluxConfig()
	if err != nil || active == nil {
		http.Error(w, `{"error":"failed to load active config after activation"}`, http.StatusInternalServerError)
		return
	}

	s.influxSvc.Close()
	s.influxSvc = influx.NewMetricsService(active.Version, active.URL, active.Token, active.Org, active.Bucket, active.Username, active.Password, active.Method)

	s.config.InfluxURL = active.URL
	s.config.InfluxToken = active.Token
	s.config.InfluxOrg = active.Org
	s.config.InfluxBucket = active.Bucket

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(active)
}

type runDefaultEnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *Server) handleGetRunDefaults(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	outputArgs, _ := s.db.GetSetting("run_default_output_args")
	useOutput, _ := s.db.GetSetting("run_default_use_output")
	useImage, _ := s.db.GetSetting("run_default_use_image")
	imageURL, _ := s.db.GetSetting("run_default_image_url")
	envVarsRaw, _ := s.db.GetSetting("run_default_env_vars")

	// Seed defaults on first access
	if outputArgs == "" {
		outputArgs = "--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s"
	}
	if useOutput == "" {
		useOutput = "false"
	}
	if useImage == "" {
		useImage = "false"
	}
	if envVarsRaw == "" {
		envVarsRaw = "[]"
	}

	var envVars []runDefaultEnvVar
	if err := json.Unmarshal([]byte(envVarsRaw), &envVars); err != nil {
		envVars = []runDefaultEnvVar{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"output_args": outputArgs,
		"use_output":  useOutput,
		"use_image":   useImage,
		"image_url":   imageURL,
		"env_vars":    envVars,
	})
}

func (s *Server) handleSaveRunDefaults(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	var body struct {
		OutputArgs string             `json:"output_args"`
		UseOutput  string             `json:"use_output"`
		UseImage   string             `json:"use_image"`
		ImageURL   string             `json:"image_url"`
		EnvVars    []runDefaultEnvVar `json:"env_vars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	cleanedEnv := make([]runDefaultEnvVar, 0, len(body.EnvVars))
	for _, envVar := range body.EnvVars {
		key := strings.TrimSpace(envVar.Key)
		if key == "" {
			continue
		}
		cleanedEnv = append(cleanedEnv, runDefaultEnvVar{
			Key:   key,
			Value: strings.TrimSpace(envVar.Value),
		})
	}
	envBytes, err := json.Marshal(cleanedEnv)
	if err != nil {
		http.Error(w, `{"error":"invalid env vars"}`, http.StatusBadRequest)
		return
	}
	pairs := map[string]string{
		"run_default_output_args": body.OutputArgs,
		"run_default_use_output":  body.UseOutput,
		"run_default_use_image":   body.UseImage,
		"run_default_image_url":   body.ImageURL,
		"run_default_env_vars":    string(envBytes),
	}
	for k, v := range pairs {
		if err := s.db.UpsertSetting(k, v); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save setting %s: %v"}`, k, err), http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "database not initialized"})
		return
	}
	list, err := s.db.GetTemplates()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("failed to get templates: %v", err)})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	newTemplate, err := decodeK6TemplateBody(r)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	// Check if a template with the same name already exists
	existingTemplates, err := s.db.GetTemplates()
	if err == nil {
		targetName := strings.ToLower(strings.TrimSpace(newTemplate.Name))
		for _, t := range existingTemplates {
			if t != nil && strings.ToLower(strings.TrimSpace(t.Name)) == targetName {
				http.Error(w, fmt.Sprintf(`{"error":"A template with name '%s' already exists"}`, newTemplate.Name), http.StatusBadRequest)
				return
			}
		}
	}

	id := fmt.Sprintf("tmpl-%d", time.Now().UnixNano())
	newTemplate.ID = id
	newTemplate.CreatedAt = time.Now()

	if err := validateK6Template(newTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if err := s.db.SaveTemplate(newTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newTemplate)
}

func (s *Server) handleUpdateTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	updatedTemplate, err := decodeK6TemplateBody(r)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	// Check if a template with the same name already exists under a different ID
	existingTemplates, err := s.db.GetTemplates()
	if err == nil {
		targetName := strings.ToLower(strings.TrimSpace(updatedTemplate.Name))
		for _, t := range existingTemplates {
			if t != nil && t.ID != id && strings.ToLower(strings.TrimSpace(t.Name)) == targetName {
				http.Error(w, fmt.Sprintf(`{"error":"A template with name '%s' already exists"}`, updatedTemplate.Name), http.StatusBadRequest)
				return
			}
		}
	}

	updatedTemplate.ID = id
	updatedTemplate.CreatedAt = time.Now()

	if err := validateK6Template(updatedTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if err := s.db.SaveTemplate(updatedTemplate); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedTemplate)
}

func decodeK6TemplateBody(r *http.Request) (*database.K6Template, error) {
	var body struct {
		Name                   string `json:"name"`
		TemplateType           string `json:"template_type"`
		Parallelism            int    `json:"parallelism"`
		ScriptName             string `json:"script_name"`
		ScriptFile             string `json:"script_file"`
		RunnerImage            string `json:"runner_image"`
		CPULimit               string `json:"cpu_limit"`
		MemLimit               string `json:"mem_limit"`
		ScriptContent          string `json:"script_content"`
		ScheduleEnabled        bool   `json:"schedule_enabled"`
		ScheduleCronExpression string `json:"schedule_cron_expression"`
		ScheduleActive         bool   `json:"schedule_active"`
		ScheduleClusterID      string `json:"schedule_cluster_id"`
		ScheduleNamespace      string `json:"schedule_namespace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid request body")
	}
	if body.TemplateType == "" {
		return nil, fmt.Errorf("template_type is required")
	}
	return &database.K6Template{
		Name:                   body.Name,
		TemplateType:           body.TemplateType,
		Parallelism:            body.Parallelism,
		ScriptName:             body.ScriptName,
		ScriptFile:             body.ScriptFile,
		RunnerImage:            body.RunnerImage,
		CPULimit:               body.CPULimit,
		MemLimit:               body.MemLimit,
		ScriptContent:          body.ScriptContent,
		ScheduleEnabled:        body.ScheduleEnabled,
		ScheduleCronExpression: body.ScheduleCronExpression,
		ScheduleActive:         body.ScheduleActive,
		ScheduleClusterID:      body.ScheduleClusterID,
		ScheduleNamespace:      body.ScheduleNamespace,
	}, nil
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing ID"}`, http.StatusBadRequest)
		return
	}

	if err := s.db.DeleteTemplate(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete template: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleListSchedules(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.GetSchedules()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get schedules: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func isRoundHourCron(expr string) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	return fields[0] == "0"
}

func (s *Server) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		database.TestSchedule
		EnforceRoundHour bool   `json:"enforce_round_hour"`
		ValidationRunID  string `json:"validation_run_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	sched := body.TestSchedule

	if sched.Name == "" || sched.ClusterID == "" || sched.Namespace == "" || sched.TemplateID == "" {
		http.Error(w, `{"error":"all fields except cron expression are required"}`, http.StatusBadRequest)
		return
	}

	if err := validateTestRunTemplateReference(s.db, sched.TemplateID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	isScheduled := sched.CronExpression != ""
	if isScheduled {
		if len(strings.Fields(sched.CronExpression)) != 5 {
			http.Error(w, `{"error":"invalid cron expression (must be exactly 5 fields)"}`, http.StatusBadRequest)
			return
		}
		if body.EnforceRoundHour && !isRoundHourCron(sched.CronExpression) {
			http.Error(w, `{"error":"schedules must start at a round hour (minute field must be 0)"}`, http.StatusBadRequest)
			return
		}
	}

	if err := s.guardianGate(r.Context(), r, s.buildScheduleSubject(&sched, r.Header.Get("X-User-Name")), body.ValidationRunID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusPreconditionFailed)
		return
	}

	sched.CreatedAt = time.Now()
	if err := s.db.SaveSchedule(&sched); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	if !isScheduled {
		if err := s.runScheduleTestRun(r.Context(), &sched, "manual"); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to run test: %v"}`, err), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func (s *Server) handleUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		database.TestSchedule
		EnforceRoundHour bool `json:"enforce_round_hour"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	sched := body.TestSchedule

	if sched.Name == "" || sched.ClusterID == "" || sched.Namespace == "" || sched.TemplateID == "" {
		http.Error(w, `{"error":"all fields except cron expression are required"}`, http.StatusBadRequest)
		return
	}

	if err := validateTestRunTemplateReference(s.db, sched.TemplateID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	if sched.CronExpression != "" {
		if len(strings.Fields(sched.CronExpression)) != 5 {
			http.Error(w, `{"error":"invalid cron expression (must be exactly 5 fields)"}`, http.StatusBadRequest)
			return
		}
		if body.EnforceRoundHour && !isRoundHourCron(sched.CronExpression) {
			http.Error(w, `{"error":"schedules must start at a round hour (minute field must be 0)"}`, http.StatusBadRequest)
			return
		}
	}

	existing, err := s.db.GetSchedule(id)
	if err != nil || existing == nil {
		http.Error(w, `{"error":"schedule not found"}`, http.StatusNotFound)
		return
	}

	sched.ID = id
	if err := s.db.SaveSchedule(&sched); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func (s *Server) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err == nil && sched != nil {
		client, isMock, err := s.getClusterClient(sched.ClusterID)
		if err == nil && !isMock {
			dnsName := strings.ToLower(sched.Name)
			dnsName = strings.ReplaceAll(dnsName, " ", "-")
			var cleaned []rune
			for _, r := range dnsName {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
					cleaned = append(cleaned, r)
				}
			}
			dnsName = string(cleaned)
			if len(dnsName) > 52 {
				dnsName = dnsName[:52]
			}
			dnsName = strings.Trim(dnsName, "-")

			_ = client.Clientset.BatchV1().CronJobs(sched.Namespace).Delete(r.Context(), dnsName, metav1.DeleteOptions{})
			_ = client.Clientset.BatchV1().Jobs(sched.Namespace).Delete(r.Context(), dnsName, metav1.DeleteOptions{})
		}
	}

	if err := s.db.DeleteSchedule(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to delete schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleRunSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err != nil || sched == nil {
		http.Error(w, `{"error":"schedule not found"}`, http.StatusNotFound)
		return
	}

	if err := s.runScheduleTestRun(r.Context(), sched, "manual"); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to run test: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (s *Server) handleToggleSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid schedule id"}`, http.StatusBadRequest)
		return
	}

	sched, err := s.db.GetSchedule(id)
	if err != nil || sched == nil {
		http.Error(w, `{"error":"schedule not found"}`, http.StatusNotFound)
		return
	}

	sched.Active = !sched.Active
	if err := s.db.SaveSchedule(sched); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to update schedule: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func (s *Server) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.GetAlerts()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to get alerts: %v"}`, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleStreamRunMetrics(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "http_req_duration"
	}
	cluster := r.URL.Query().Get("cluster")
	namespace := r.URL.Query().Get("namespace")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, "5m", "", "", cluster, namespace)
	if err == nil {
		data, _ := json.Marshal(points)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			points, err := s.influxSvc.QueryK6Metrics(r.Context(), runID, metric, "10s", "", "", cluster, namespace)
			if err != nil {
				continue
			}
			data, _ := json.Marshal(points)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
