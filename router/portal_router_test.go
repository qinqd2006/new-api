package router

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPortalDoesNotRegisterManagementOrGenerationRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousTarget := common.PortalGatewayInternalURL
	common.PortalGatewayInternalURL = "http://127.0.0.1:3000"
	t.Cleanup(func() { common.PortalGatewayInternalURL = previousTarget })
	previous := common.PortalOnly
	common.PortalOnly = true
	t.Cleanup(func() { common.PortalOnly = previous })
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(`<meta name="new-api-surface" content="portal">portal`), 0600))
	t.Setenv("PORTAL_WEB_DIR", dir)
	engine := gin.New()
	require.NotPanics(t, func() { SetRouter(engine, WebAssets{}) })
	actual := map[string]bool{}
	for _, route := range engine.Routes() {
		actual[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{"POST /pg/chat/completions", "POST /api/user/login", "POST /api/user/auth/refresh", "GET /api/user/self", "GET /api/token/", "GET /api/log/self", "GET /api/task/self", "GET /api/pricing", "GET /api/user/topup/self", "GET /api/data/self"} {
		assert.True(t, actual[route], "missing user route %s", route)
	}
	for _, path := range []string{"/api/setup", "/api/option/", "/api/channel/", "/api/channel/1/key", "/api/user/", "/api/user/1", "/api/user/manage", "/api/subscription/admin/plans", "/api/task_plugin", "/api/system-info/instances", "/api/log/", "/api/task", "/api/group/", "/api/models/", "/api/authz/roles", "/v1/chat/completions", "/tencentmps", "/tencenttokenhub/v1/wand/vega-images/generations", "/setup", "/channels", "/system-settings/site"} {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
			req := httptest.NewRequest(method, path, nil)
			req.Header.Set("Authorization", "Bearer administrative-credential")
			req.Header.Set("X-TC-Action", "CreateAigcImageTask")
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			assert.Equal(t, http.StatusNotFound, w.Code, "%s %s: %s", method, path, w.Body.String())
		}
	}
	for _, path := range []string{"/keys", "/dashboard/overview", "/wallet", "/profile", "/security", "/sign-in"} {
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, http.StatusOK, w.Code, path)
		assert.Contains(t, w.Body.String(), "portal")
	}
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/user/self", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestPortalRejectsFullFrontendBuild(t *testing.T) {
	previous := common.PortalGatewayInternalURL
	common.PortalGatewayInternalURL = "http://127.0.0.1:3000"
	t.Cleanup(func() { common.PortalGatewayInternalURL = previous })
	dir := t.TempDir()
	t.Setenv("PORTAL_WEB_DIR", dir)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("management app"), 0600))
	require.Panics(t, func() { SetPortalRouter(gin.New()) })
}

func TestSplitDeploymentRejectsUnsafeConfiguration(t *testing.T) {
	oldInternal, oldPortalKey := common.PortalGatewayInternalURL, common.PortalSessionSecret
	t.Cleanup(func() { common.PortalGatewayInternalURL, common.PortalSessionSecret = oldInternal, oldPortalKey })
	oldPortal, oldPublic, oldGateway, oldSecret, oldMaster := common.PortalOnly, common.PortalPublicURL, common.PortalGatewayURL, common.SessionSecret, common.IsMasterNode
	oldSecure, oldTrusted := common.SessionCookieSecure, common.SessionCookieTrustedURLs
	t.Cleanup(func() {
		common.PortalOnly, common.PortalPublicURL, common.PortalGatewayURL, common.SessionSecret, common.IsMasterNode = oldPortal, oldPublic, oldGateway, oldSecret, oldMaster
		common.SessionCookieSecure, common.SessionCookieTrustedURLs = oldSecure, oldTrusted
	})
	t.Setenv("SERVICE_ROLE", "portal")
	t.Setenv("PORTAL_SESSION_SECRET", "separate-portal-signing-key-of-sufficient-length")
	t.Setenv("SESSION_SECRET", "separate-admin-signing-key-of-sufficient-length")
	t.Setenv("CRYPTO_SECRET", "shared-data-key")
	t.Setenv("PORTAL_PUBLIC_URL", "https://console.example.com")
	t.Setenv("PORTAL_GATEWAY_INTERNAL_URL", "http://127.0.0.1:3000")
	t.Setenv("PORTAL_GATEWAY_URL", "https://api.example.com")
	common.SessionCookieSecure = true
	common.SessionCookieTrustedURLs = []string{"https://console.example.com"}
	require.NoError(t, common.InitServiceRole())
	assert.Equal(t, "https://console.example.com", common.PublicWebURL("https://admin.example.com"))
	for _, test := range []struct{ key, value string }{
		{"SERVICE_ROLE", "typo"},
		{"PORTAL_SESSION_SECRET", "short"},
		{"PORTAL_SESSION_SECRET", "separate-admin-signing-key-of-sufficient-length"},
		{"CRYPTO_SECRET", ""},
		{"PORTAL_PUBLIC_URL", "http://console.example.com"},
		{"PORTAL_PUBLIC_URL", "https://console.example.com/path"},
		{"PORTAL_GATEWAY_URL", "https://console.example.com"},
		{"PORTAL_GATEWAY_URL", "http://api.example.com"},
	} {
		t.Run(test.key+test.value, func(t *testing.T) { t.Setenv(test.key, test.value); require.Error(t, common.InitServiceRole()) })
	}
	common.SessionCookieSecure = false
	require.Error(t, common.InitServiceRole())
	common.SessionCookieSecure = true
	common.SessionCookieTrustedURLs = []string{"https://console.example.com", "https://admin.example.com"}
	require.Error(t, common.InitServiceRole())
	t.Setenv("SERVICE_ROLE", "full")
	t.Setenv("SESSION_SECRET", "shared-data-key")
	require.Error(t, common.InitServiceRole())
}

func TestCLBIngressEnforcesHostPathAndAdministratorBoundary(t *testing.T) {
	previous := common.PortalOnly
	common.PortalOnly = false
	t.Cleanup(func() { common.PortalOnly = previous })
	t.Setenv("CLB_INGRESS_ENABLED", "true")
	t.Setenv("TRUSTED_PROXIES", "10.0.1.5/32")
	t.Setenv("INGRESS_ADMIN_HOST", "admin.example.com")
	t.Setenv("INGRESS_API_HOST", "api.example.com")
	t.Setenv("INGRESS_PORTAL_HOST", "console.example.com")
	t.Setenv("INGRESS_INTERNAL_IP", "10.0.1.10")
	t.Setenv("INGRESS_ADMIN_CIDRS", "203.0.113.10/32")
	engine := gin.New()
	require.NoError(t, engine.SetTrustedProxies([]string{"10.0.1.5/32"}))
	require.NoError(t, ConfigureCLBIngress(engine))
	engine.NoRoute(func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for _, tc := range []struct {
		name, host, path, method, peer, forwarded, action string
		want                                              int
	}{
		{"api models", "api.example.com", "/v1/models", "GET", "198.51.100.5:1234", "", "", 204},
		{"api management denied", "api.example.com", "/api/channel/", "GET", "198.51.100.5:1234", "", "", 404},
		{"api page denied", "api.example.com", "/setup", "GET", "198.51.100.5:1234", "", "", 404},
		{"api playground denied", "api.example.com", "/pg/chat/completions", "POST", "198.51.100.5:1234", "", "", 404},
		{"path traversal denied", "api.example.com", "/v1/../api/channel/", "GET", "198.51.100.5:1234", "", "", 404},
		{"mps SDK", "api.example.com", "/", "POST", "198.51.100.5:1234", "", "CreateAigcImageTask", 204},
		{"root action required", "api.example.com", "/", "POST", "198.51.100.5:1234", "", "", 404},
		{"tokenhub native", "api.example.com", "/tencenttokenhub/v1/images", "POST", "198.51.100.5:1234", "", "", 204},
		{"admin source preserved", "admin.example.com", "/api/setup", "GET", "203.0.113.10:1234", "", "", 204},
		{"admin trusted proxy", "admin.example.com", "/api/setup", "GET", "10.0.1.5:1234", "203.0.113.10", "", 204},
		{"admin spoofed forwarding", "admin.example.com", "/api/setup", "GET", "198.51.100.5:1234", "203.0.113.10", "", 403},
		{"admin forwarded chain", "admin.example.com", "/api/setup", "GET", "10.0.1.5:1234", "203.0.113.10, 198.51.100.5", "", 403},
		{"unknown host", "unknown.example.com", "/v1/models", "GET", "203.0.113.10:1234", "", "", 404},
		{"private origin external denied", "10.0.1.10:3000", "/pg/chat/completions", "POST", "198.51.100.5:1234", "10.0.1.10", "", 404},
		{"private origin local playground", "10.0.1.10:3000", "/pg/chat/completions", "POST", "10.0.1.10:1234", "", "", 204},
		{"CLB health", "10.0.1.10:3000", "/healthz", "GET", "100.64.1.1:1234", "", "", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
			req.RemoteAddr = tc.peer
			req.Header.Set("X-Forwarded-For", tc.forwarded)
			req.Header.Set("X-Forwarded-Host", "admin.example.com")
			req.Header.Set("X-TC-Action", tc.action)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, req)
			assert.Equal(t, tc.want, response.Code)
		})
	}
	common.PortalOnly = true
	portal := gin.New()
	require.NoError(t, ConfigureCLBIngress(portal))
	portal.NoRoute(func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for host, want := range map[string]int{"console.example.com": 204, "api.example.com": 404, "admin.example.com": 404} {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/api/user/self", nil)
		req.RemoteAddr = "198.51.100.5:1234"
		response := httptest.NewRecorder()
		portal.ServeHTTP(response, req)
		assert.Equal(t, want, response.Code, host)
	}
	t.Setenv("INGRESS_ADMIN_CIDRS", "0.0.0.0/0")
	assert.Error(t, ConfigureCLBIngress(gin.New()))
}
