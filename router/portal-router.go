package router

import (
	"bytes"
	"github.com/QuantumNous/new-api/common"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// SetPortalRouter registers only the user API and the independently built
// portal assets. There is no plugin dispatcher, relay, setup, or admin router.
func SetPortalRouter(engine *gin.Engine) {
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	api := engine.Group("/api", middleware.RouteTag("api"), gzip.Gzip(gzip.DefaultCompression), middleware.AccessTokenAudit(), middleware.BodyStorageCleanup(), middleware.GlobalAPIRateLimit())
	registerUserAPIRoutes(api)
	target, err := url.Parse(common.PortalGatewayInternalURL)
	if err != nil || target.Host == "" {
		panic("PORTAL_GATEWAY_INTERNAL_URL is required")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		authorization := request.Header.Get("Authorization")
		request.Header = http.Header{"Authorization": []string{authorization}, "Content-Type": []string{"application/json"}}
		director(request)
		request.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(http.StatusBadGateway) }
	engine.POST("/pg/chat/completions", middleware.RouteTag("api"), middleware.UserAuth(), middleware.GlobalAPIRateLimit(), func(c *gin.Context) { proxy.ServeHTTP(c.Writer, c.Request) })
	content := engine.Group("/v1/tasks", middleware.RouteTag("relay"), middleware.TokenOrTaskArtifactAccessAuth("key", "artifact_key"))
	content.GET("/:key/artifacts/:artifact_key/content", controller.TaskArtifactContent)
	content.HEAD("/:key/artifacts/:artifact_key/content", controller.TaskArtifactContent)
	dir := os.Getenv("PORTAL_WEB_DIR")
	if dir == "" {
		dir = "web/dist-portal"
	}
	index, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil || !bytes.Contains(index, []byte(`name="new-api-surface" content="portal"`)) {
		panic("PORTAL_WEB_DIR must contain a portal build (bun run build:portal)")
	}
	fs := static.LocalFile(dir, false)
	engine.NoRoute(middleware.RouteTag("web"), middleware.GlobalWebRateLimit(fs), func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		path := c.Request.URL.Path
		// Only public/user page paths may receive the SPA shell. Unknown API and
		// management paths never fall back to a successful HTML response.
		for _, prefix := range []string{"/api", "/v1", "/pg", "/mj", "/tencentmps", "/tencenttokenhub", "/setup", "/channels", "/users", "/models", "/subscriptions", "/redemption-codes", "/system-settings", "/system-info", "/task-plugins"} {
			if path == prefix || strings.HasPrefix(path, prefix+"/") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
		}
	}, middleware.ServeFrontendFiles(fs), func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/static/") || strings.HasPrefix(c.Request.URL.Path, "/assets/") {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Data(http.StatusOK, "text/html; charset=utf-8", index)
	})
}
