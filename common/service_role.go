package common

import (
	"fmt"
	"os"
	"strings"
)

// PortalOnly selects the independently deployed user service. The default
// remains the existing management/gateway server for backwards compatibility.
var PortalOnly bool
var PortalPublicURL string
var PortalGatewayURL string
var PortalGatewayInternalURL string
var PortalSessionSecret string

func InitServiceRole() error {
	role := strings.TrimSpace(os.Getenv("SERVICE_ROLE"))
	if role != "" && role != "full" && role != "portal" {
		return fmt.Errorf("SERVICE_ROLE must be full or portal")
	}
	PortalOnly = role == "portal"
	PortalPublicURL = ""
	PortalGatewayURL = ""
	PortalGatewayInternalURL = ""
	PortalSessionSecret = ""
	if secret := os.Getenv("PORTAL_SESSION_SECRET"); secret != "" {
		if len(secret) < 32 || secret == os.Getenv("SESSION_SECRET") {
			return fmt.Errorf("PORTAL_SESSION_SECRET must be independent and at least 32 bytes")
		}
		PortalSessionSecret = GenerateHMACWithKey([]byte(secret), "new-api/user-portal/v1")
	}
	if !PortalOnly {
		// Explicit full mode is used by split deployments. The portal shares the
		// data key, so that key must never also sign management login sessions.
		if role == "full" && (len(os.Getenv("SESSION_SECRET")) < 32 || os.Getenv("CRYPTO_SECRET") == "" || os.Getenv("SESSION_SECRET") == os.Getenv("CRYPTO_SECRET")) {
			return fmt.Errorf("split management requires a SESSION_SECRET of at least 32 bytes distinct from CRYPTO_SECRET")
		}
		return nil
	}
	secret := os.Getenv("PORTAL_SESSION_SECRET")
	if len(secret) < 32 || secret == os.Getenv("SESSION_SECRET") {
		return fmt.Errorf("portal requires a separate PORTAL_SESSION_SECRET of at least 32 bytes")
	}
	if os.Getenv("CRYPTO_SECRET") == "" {
		return fmt.Errorf("portal requires the existing CRYPTO_SECRET for shared account encryption")
	}
	origin, err := NormalizeOrigin(os.Getenv("PORTAL_PUBLIC_URL"))
	if err != nil {
		return fmt.Errorf("invalid PORTAL_PUBLIC_URL: %w", err)
	}
	if !strings.HasPrefix(origin, "https://") {
		if os.Getenv("PORTAL_ALLOW_INSECURE_LOCAL") != "true" || (origin != "http://localhost:3001" && origin != "http://127.0.0.1:3001") {
			return fmt.Errorf("PORTAL_PUBLIC_URL requires HTTPS (local development permits localhost:3001 only)")
		}
	} else if !SessionCookieSecure || len(SessionCookieTrustedURLs) != 1 || SessionCookieTrustedURLs[0] != origin {
		return fmt.Errorf("portal requires secure cookies and SESSION_COOKIE_TRUSTED_URL equal to PORTAL_PUBLIC_URL")
	}
	gateway, err := NormalizeOrigin(os.Getenv("PORTAL_GATEWAY_URL"))
	if err != nil {
		return fmt.Errorf("invalid PORTAL_GATEWAY_URL: %w", err)
	}
	if !strings.HasPrefix(gateway, "https://") && !(os.Getenv("PORTAL_ALLOW_INSECURE_LOCAL") == "true" && (gateway == "http://127.0.0.1:3000" || gateway == "http://localhost:3000")) {
		return fmt.Errorf("PORTAL_GATEWAY_URL requires HTTPS")
	}
	if gateway == origin {
		return fmt.Errorf("portal and gateway must have separate origins")
	}
	internal, err := NormalizeOrigin(os.Getenv("PORTAL_GATEWAY_INTERNAL_URL"))
	if err != nil {
		return fmt.Errorf("invalid PORTAL_GATEWAY_INTERNAL_URL: %w", err)
	}
	if internal == origin {
		return fmt.Errorf("portal must not proxy playground requests to itself")
	}
	PortalGatewayInternalURL = internal
	PortalPublicURL = origin
	PortalGatewayURL = gateway
	// All dashboard JWTs, refresh secrets, and one-time auth flows use this
	// process-specific secret; the shared data encryption key stays unchanged.
	SessionSecret = PortalSessionSecret
	IsMasterNode = false
	return nil
}

func PublicWebURL(fallback string) string {
	if PortalOnly {
		return PortalPublicURL
	}
	return fallback
}
