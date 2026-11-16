package tencent

// ModelList contains the TokenHub models served through its OpenAI-compatible
// chat and embeddings APIs. Generation-task models live in the
// tencenttokenhub task plugin because they use vendor-specific asynchronous or
// synchronous endpoints instead of the OpenAI relay surface.
var ModelList = []string{
	// TokenHub language models.
	"hy4",
	"hy4-preview",
	"hy3",
	"hy-mt2-pro",
	"hy-mt2-plus",
	"hy-mt2-lite",
	"hunyuan-role-latest",
	"hy-role",
	"deepseek/deepseek-flash",
	"deepseek-v4-flash-202605",
	"deepseek/deepseek-v4-flash-0731",
	"deepseek/deepseek-v4-flash",
	"deepseek-v4-pro-202606",
	"deepseek/deepseek-v4-pro-0813",
	"deepseek/deepseek-v4-pro",
	"deepseek/deepseek-v4-flash-vision-exp",
	"deepseek-v4.1-flash-1017",
	"deepseek-v4.1-flash",
	"deepseek-v4-pro-0813",
	"deepseek-v4-pro",
	"glm-5.3-flash",
	"glm-5.3-flashx",
	"glm-5.3",
	"glm-5.2",
	"kimi-k2.7-code-highspeed",
	"kimi-k3.1-pro-highspeed",
	"kimi-k3.1-pro",
	"kimi-k3",
	"kimi-k2.8-preview",
	"kimi-k2.7-code",
	"kimi-k2.6",
	"minimax-m3.1-flash",
	"minimax-m3",
	"minimax-m2.7",
	"mimo-v2.6-pro",
	"mimo-v2.6-flash",
	"mimo-v2.5-pro",
	"step-5-preview",

	// TokenHub multimodal-understanding models use the same compatible API.
	"youtu-vita",
	"hy-vision-2.0-instruct",
	"hunyuan-t1-vision-20250916",
	"hunyuan-turbos-vision-video-20250728",

	// TokenHub OpenAI-compatible embeddings models.
	"kinfra-text-embedding-0.6b",
	"kinfra-text-embedding-4b",
	"kinfra-vl-embedding-2b",
	"kinfra-vl-embedding-8b",

	// Legacy Tencent Hunyuan names remain available for TC3 channels.
	"hunyuan-lite",
	"hunyuan-standard",
	"hunyuan-standard-256K",
	"hunyuan-pro",
}

var ChannelName = "tencent"
