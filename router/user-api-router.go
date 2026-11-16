package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// registerUserAPIRoutes is the explicit public/user surface shared by the
// standalone portal and the legacy combined server. Management routes must
// remain in SetApiRouter; the portal never registers them.
func registerUserAPIRoutes(apiRouter *gin.RouterGroup) {
	anonymousRequestBodyLimit := middleware.AnonymousRequestBodyLimit()
	apiRouter.GET("/status", controller.GetStatus)
	apiRouter.GET("/uptime/status", controller.GetUptimeKumaStatus)
	apiRouter.GET("/models", middleware.UserAuth(), controller.DashboardListModels)
	apiRouter.GET("/notice", controller.GetNotice)
	apiRouter.GET("/user-agreement", controller.GetUserAgreement)
	apiRouter.GET("/privacy-policy", controller.GetPrivacyPolicy)
	apiRouter.GET("/about", controller.GetAbout)
	//apiRouter.GET("/midjourney", controller.GetMidjourney)
	apiRouter.GET("/home_page_content", controller.GetHomePageContent)
	apiRouter.GET("/pricing", middleware.HeaderNavModuleAuth("pricing"), controller.GetPricing)
	perfMetricsRoute := apiRouter.Group("/perf-metrics")
	perfMetricsRoute.Use(middleware.HeaderNavModulePublicOrUserAuth("pricing"))
	{
		perfMetricsRoute.GET("/summary", controller.GetPerfMetricsSummary)
		perfMetricsRoute.GET("", controller.GetPerfMetrics)
	}
	apiRouter.GET("/rankings", middleware.HeaderNavModuleAuth("rankings"), controller.GetRankings)
	apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
	apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
	apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, controller.ResetPassword)
	// OAuth routes - specific routes must come before :provider wildcard
	apiRouter.POST("/oauth/state", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), anonymousRequestBodyLimit, controller.GenerateOAuthCode)
	apiRouter.POST("/oauth/email/bind/start", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.EmailVerificationRateLimit(), middleware.DisableCache(), controller.EmailBindStart)
	apiRouter.POST("/oauth/email/bind/resend", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.EmailVerificationRateLimit(), middleware.DisableCache(), controller.EmailBindResend)
	apiRouter.POST("/oauth/email/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.DisableCache(), controller.EmailBind)
	// WeChat uses its existing authorization-code service.
	apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.WeChatAuth)
	apiRouter.POST("/oauth/wechat/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.WeChatBind)
	apiRouter.GET("/oauth/telegram/login", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
	apiRouter.POST("/oauth/telegram/bind/start", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
	apiRouter.GET("/oauth/telegram/bind/:flow_token", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
	// Standard OAuth providers (GitHub, Discord, OIDC, LinuxDO, Telegram) - unified route
	apiRouter.GET("/oauth/:provider", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), controller.HandleOAuth)
	apiRouter.POST("/stripe/webhook", anonymousRequestBodyLimit, controller.StripeWebhook)
	apiRouter.POST("/creem/webhook", anonymousRequestBodyLimit, controller.CreemWebhook)
	apiRouter.POST("/waffo/webhook", anonymousRequestBodyLimit, controller.WaffoWebhook)
	// :env separates test vs prod URLs so the operator can register each
	// in Pancake's matching webhook slot; handler enforces env match.
	apiRouter.POST("/waffo-pancake/webhook/:env", anonymousRequestBodyLimit, controller.WaffoPancakeWebhook)

	// Universal secure verification routes
	apiRouter.GET("/verify/methods", middleware.UserAuth(), middleware.DisableCache(), controller.GetVerificationMethods)
	apiRouter.POST("/verify", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.UniversalVerify)

	userRoute := apiRouter.Group("/user")
	{
		userRoute.POST("/auth/refresh", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.RefreshAuth)
		userRoute.POST("/auth/logout", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AuthLogout)
		userRoute.POST("/register", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Register)
		userRoute.GET("/login/encryption-key", middleware.DisableCache(), controller.GetPasswordEncryptionKey)
		userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Login)
		userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.Verify2FALogin)
		userRoute.POST("/login/verify", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.VerifyLogin)
		userRoute.POST("/login/passkey/begin", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.LoginPasskeyBegin)
		userRoute.POST("/login/passkey/finish", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.LoginPasskeyFinish)
		userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginBegin)
		userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginFinish)
		//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
		userRoute.POST("/epay/notify", anonymousRequestBodyLimit, controller.EpayNotify)
		userRoute.GET("/epay/notify", controller.EpayNotify)
		userRoute.GET("/groups", controller.GetUserGroups)

		selfRoute := userRoute.Group("/")
		selfRoute.Use(middleware.DisableCache(), middleware.UserAuth())
		{
			selfRoute.GET("/sessions", middleware.DisableCache(), controller.GetLoginSessions)
			selfRoute.DELETE("/sessions/:sid", middleware.DisableCache(), controller.DeleteLoginSession)
			selfRoute.POST("/sessions/revoke-others", middleware.DisableCache(), controller.RevokeOtherLoginSessions)
			selfRoute.GET("/self/groups", controller.GetUserGroups)
			selfRoute.GET("/self", controller.GetSelf)
			selfRoute.GET("/models", controller.GetUserModels)
			selfRoute.PUT("/self", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateSelf)
			selfRoute.DELETE("/self", middleware.DisableCache(), controller.DeleteSelf)
			accessTokenRoute := selfRoute.Group("/access_tokens")
			accessTokenRoute.Use(middleware.DisableCache())
			{
				accessTokenRoute.GET("", controller.ListAccessTokens)
				accessTokenRoute.GET("/catalog", controller.GetAccessTokenCatalog)
				accessTokenRoute.GET("/scopes", controller.GetAccessTokenScopes)
				accessTokenRoute.POST("", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), controller.CreateAccessToken)
				accessTokenRoute.PATCH("/:id", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), controller.UpdateAccessToken)
				accessTokenRoute.DELETE("/:id", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), controller.DeleteAccessToken)
				accessTokenRoute.DELETE("/legacy", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), controller.RevokeLegacyAccessToken)
			}
			selfRoute.GET("/passkey", controller.PasskeyStatus)
			selfRoute.POST("/passkey/register/begin", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyRegisterBegin)
			selfRoute.POST("/passkey/register/finish", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyRegisterFinish)
			selfRoute.POST("/passkey/verify/begin", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyVerifyBegin)
			selfRoute.POST("/passkey/verify/finish", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyVerifyFinish)
			selfRoute.DELETE("/passkey", middleware.DisableCache(), controller.PasskeyDelete)
			selfRoute.GET("/aff", controller.GetAffCode)
			selfRoute.GET("/topup/info", controller.GetTopUpInfo)
			selfRoute.GET("/topup/self", controller.GetUserTopUps)
			selfRoute.POST("/topup", middleware.CriticalRateLimit(), controller.TopUp)
			selfRoute.POST("/pay", middleware.CriticalRateLimit(), controller.RequestEpay)
			selfRoute.POST("/amount", controller.RequestAmount)
			selfRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.RequestStripePay)
			selfRoute.POST("/stripe/amount", controller.RequestStripeAmount)
			selfRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.RequestCreemPay)
			selfRoute.POST("/waffo/amount", controller.RequestWaffoAmount)
			selfRoute.POST("/waffo/pay", middleware.CriticalRateLimit(), controller.RequestWaffoPay)
			selfRoute.POST("/waffo-pancake/amount", controller.RequestWaffoPancakeAmount)
			selfRoute.POST("/waffo-pancake/pay", middleware.CriticalRateLimit(), controller.RequestWaffoPancakePay)
			selfRoute.POST("/aff_transfer", middleware.UserCriticalRateLimit("aff-transfer"), controller.TransferAffQuota)
			selfRoute.PUT("/setting", controller.UpdateUserSetting)

			// 2FA routes
			selfRoute.GET("/2fa/status", controller.Get2FAStatus)
			selfRoute.POST("/2fa/setup", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.Setup2FA)
			selfRoute.POST("/2fa/enable", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.Enable2FA)
			selfRoute.POST("/2fa/disable", middleware.DisableCache(), controller.Disable2FA)
			selfRoute.POST("/2fa/backup_codes", middleware.DisableCache(), controller.RegenerateBackupCodes)

			// Check-in routes
			selfRoute.GET("/checkin", controller.GetCheckinStatus)
			selfRoute.POST("/checkin", middleware.TurnstileCheck(), controller.DoCheckin)

			// Custom OAuth bindings
			selfRoute.GET("/oauth/bindings", controller.GetUserOAuthBindings)
			selfRoute.DELETE("/oauth/bindings/:provider_id", controller.UnbindCustomOAuth)
		}

	}
	// Subscription billing (plans, purchase, admin management)
	subscriptionRoute := apiRouter.Group("/subscription")
	subscriptionRoute.Use(middleware.UserAuth())
	{
		subscriptionRoute.GET("/plans", controller.GetSubscriptionPlans)
		subscriptionRoute.GET("/self", controller.GetSubscriptionSelf)
		subscriptionRoute.PUT("/self/preference", controller.UpdateSubscriptionPreference)
		subscriptionRoute.POST("/balance/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestBalancePay)
		subscriptionRoute.POST("/epay/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestEpay)
		subscriptionRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestStripePay)
		subscriptionRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestCreemPay)
		subscriptionRoute.POST("/waffo-pancake/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestWaffoPancakePay)
	}
	// Subscription payment callbacks (no auth)
	apiRouter.POST("/subscription/epay/notify", anonymousRequestBodyLimit, controller.SubscriptionEpayNotify)
	apiRouter.GET("/subscription/epay/notify", controller.SubscriptionEpayNotify)
	apiRouter.GET("/subscription/epay/return", controller.SubscriptionEpayReturn)
	apiRouter.POST("/subscription/epay/return", anonymousRequestBodyLimit, controller.SubscriptionEpayReturn)
	tokenRoute := apiRouter.Group("/token")
	tokenRoute.Use(middleware.UserAuth())
	tokenRoute.Use(middleware.TokenOperationAudit())
	{
		tokenRoute.GET("/", controller.GetAllTokens)
		tokenRoute.GET("/search", middleware.SearchRateLimit(), controller.SearchTokens)
		tokenRoute.GET("/auto-groups", controller.GetTokenAutoGroups)
		tokenRoute.GET("/:id", controller.GetToken)
		tokenRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKey)
		tokenRoute.POST("/", controller.AddToken)
		tokenRoute.PUT("/", controller.UpdateToken)
		tokenRoute.DELETE("/:id", controller.DeleteToken)
		tokenRoute.POST("/batch", controller.DeleteTokenBatch)
		tokenRoute.POST("/batch/keys", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKeysBatch)
	}

	apiRouter.GET("/audit/self", middleware.DisableCache(), middleware.UserAuth(), controller.GetAuditLogs)
	apiRouter.GET("/log/self/stat", middleware.UserAuth(), controller.GetLogsSelfStat)
	apiRouter.GET("/log/self", middleware.UserAuth(), controller.GetUserLogs)
	apiRouter.GET("/log/self/export", middleware.UserAuth(), controller.ExportUserLogs)
	apiRouter.GET("/log/self/search", middleware.UserAuth(), middleware.SearchRateLimit(), controller.SearchUserLogs)
	apiRouter.GET("/data/self", middleware.UserAuth(), controller.GetUserQuotaDates)
	apiRouter.GET("/data/flow/self", middleware.UserAuth(), controller.GetUserFlowQuotaDates)
	apiRouter.GET("/mj/self", middleware.UserAuth(), controller.GetUserMidjourney)
	apiRouter.GET("/task/self", middleware.UserAuth(), controller.GetUserTask)
	apiRouter.GET("/task/:task_id/artifacts", middleware.UserAuth(), controller.GetDashboardTaskArtifacts)
}
