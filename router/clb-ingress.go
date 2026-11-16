package router

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// ConfigureCLBIngress replaces the host/path boundary normally provided by a
// local reverse proxy. It supplements, and never replaces, route authentication.
func ConfigureCLBIngress(engine *gin.Engine) error {
	enabled := os.Getenv("CLB_INGRESS_ENABLED")
	if enabled == "" || enabled == "false" {
		return nil
	}
	if enabled != "true" {
		return fmt.Errorf("CLB_INGRESS_ENABLED must be true or false")
	}
	proxies, defaults, err := common.ResolveTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil || defaults {
		return fmt.Errorf("CLB ingress requires explicit TRUSTED_PROXIES or none")
	}
	for _, proxy := range proxies {
		if prefix, err := netip.ParsePrefix(proxy); err == nil && prefix.Bits() == 0 {
			return fmt.Errorf("CLB ingress must not trust all proxy addresses")
		}
	}
	adminHost := os.Getenv("INGRESS_ADMIN_HOST")
	apiHost := os.Getenv("INGRESS_API_HOST")
	portalHost := os.Getenv("INGRESS_PORTAL_HOST")
	for _, host := range []string{adminHost, apiHost, portalHost} {
		origin, err := common.NormalizeOrigin("https://" + host)
		if err != nil || host == "" || origin != "https://"+host || strings.ContainsAny(host, "/:@") {
			return fmt.Errorf("CLB ingress requires canonical DNS hostnames")
		}
	}
	if adminHost == apiHost || adminHost == portalHost || apiHost == portalHost {
		return fmt.Errorf("CLB ingress requires distinct hostnames")
	}
	internalIP, err := netip.ParseAddr(os.Getenv("INGRESS_INTERNAL_IP"))
	if err != nil || !internalIP.IsPrivate() || internalIP.IsLoopback() {
		return fmt.Errorf("CLB ingress requires the server private IP")
	}
	var adminNetworks []netip.Prefix
	for raw := range strings.FieldsSeq(os.Getenv("INGRESS_ADMIN_CIDRS")) {
		prefix, err := netip.ParsePrefix(raw)
		if err != nil {
			address, addressErr := netip.ParseAddr(raw)
			if addressErr != nil {
				return fmt.Errorf("invalid CLB administrator IP allowlist")
			}
			prefix = netip.PrefixFrom(address, address.BitLen())
		}
		if prefix.Bits() == 0 {
			return fmt.Errorf("CLB administrator allowlist must not allow all addresses")
		}
		adminNetworks = append(adminNetworks, prefix.Masked())
	}
	if len(adminNetworks) == 0 {
		return fmt.Errorf("CLB administrator IP allowlist is required")
	}
	portalOnly := common.PortalOnly
	actionPattern := regexp.MustCompile(`^(Create|Describe)Aigc[A-Za-z]+Task$`)
	engine.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/healthz" && (c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead) {
			c.Next()
			return
		}
		host := c.Request.Host
		if name, _, err := net.SplitHostPort(host); err == nil {
			host = name
		}
		host = strings.TrimSuffix(strings.ToLower(host), ".")
		// Only direct requests from this host may use the private-IP origin for
		// setup probes and the authenticated internal playground proxy. Never
		// use forwarded headers for this exception.
		peerHost, _, _ := net.SplitHostPort(c.Request.RemoteAddr)
		peer, _ := netip.ParseAddr(peerHost)
		if host == internalIP.String() && (peer.Unmap() == internalIP.Unmap() || peer.IsLoopback()) {
			c.Next()
			return
		}
		if portalOnly {
			if host != portalHost {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			c.Next()
			return
		}
		if host == adminHost {
			client, _ := netip.ParseAddr(c.ClientIP())
			for _, network := range adminNetworks {
				if network.Contains(client.Unmap()) {
					c.Next()
					return
				}
			}
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if host == apiHost {
			requestPath := c.Request.URL.Path
			if requestPath == "/" && c.Request.Method == http.MethodPost && actionPattern.MatchString(c.GetHeader("X-TC-Action")) {
				c.Next()
				return
			}
			if path.Clean(requestPath) == strings.TrimSuffix(requestPath, "/") {
				for _, prefix := range []string{"/v1", "/tencentmps", "/tencenttokenhub"} {
					if requestPath == prefix || strings.HasPrefix(requestPath, prefix+"/") {
						c.Next()
						return
					}
				}
			}
		}
		c.AbortWithStatus(http.StatusNotFound)
	})
	engine.Match([]string{http.MethodGet, http.MethodHead}, "/healthz", func(c *gin.Context) { c.Status(http.StatusOK) })
	return nil
}
