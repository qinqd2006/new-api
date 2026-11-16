package plugins_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadTencentMPSPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("tencentmps")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "tencentmps"})
	require.NoError(t, err)
	return plugin
}

func loadTencentTokenHubPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("tencenttokenhub")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "tencenttokenhub"})
	require.NoError(t, err)
	return plugin
}

// tc3ReferenceSignature computes the Tencent Cloud TC3-HMAC-SHA256
// Authorization header the same way the vendor SDK does, so the plugin's
// JavaScript implementation is checked against an independent computation
// rather than against itself.
func tc3ReferenceSignature(secretID, secretKey, host, action, body string, timestamp int64) string {
	sha256Hex := func(s string) string {
		sum := sha256.Sum256([]byte(s))
		return hex.EncodeToString(sum[:])
	}
	hmacSHA256 := func(s string, key []byte) []byte {
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(s))
		return mac.Sum(nil)
	}
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")
	canonicalHeaders := "content-type:application/json\nhost:" + host + "\nx-tc-action:" + strings.ToLower(action) + "\n"
	signedHeaders := "content-type;host;x-tc-action"
	canonicalRequest := strings.Join([]string{
		"POST",
		"/",
		"",
		canonicalHeaders,
		signedHeaders,
		sha256Hex(body),
	}, "\n")
	credentialScope := date + "/mps/tc3_request"
	stringToSign := strings.Join([]string{
		"TC3-HMAC-SHA256",
		strconv.FormatInt(timestamp, 10),
		credentialScope,
		sha256Hex(canonicalRequest),
	}, "\n")
	secretDate := hmacSHA256(date, []byte("TC3"+secretKey))
	secretService := hmacSHA256("mps", secretDate)
	signingKey := hmacSHA256("tc3_request", secretService)
	return "TC3-HMAC-SHA256 Credential=" + secretID + "/" + credentialScope +
		", SignedHeaders=" + signedHeaders + ", Signature=" + hex.EncodeToString(hmacSHA256(stringToSign, signingKey))
}

// callPlugin invokes a plugin export and decodes the JSON result.
func callPlugin(t *testing.T, plugin *jsplugin.LoadedPlugin, name string, args ...any) map[string]any {
	t.Helper()
	value, err := plugin.Engine.Call(t.Context(), name, args...)
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func callPluginPath(t *testing.T, plugin *jsplugin.LoadedPlugin, root string, path []string, args ...any) map[string]any {
	t.Helper()
	value, err := plugin.Engine.CallPath(t.Context(), root, path, args...)
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	return string(encoded)
}

func TestTencentMPSDeclaresNativeRoute(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	routes := make(map[string]jsplugin.Route, len(plugin.Meta.Routes))
	for _, route := range plugin.Meta.Routes {
		routes[route.Method+" "+route.Path] = route
	}
	require.Contains(t, routes, "POST /tencentmps")
	assert.Equal(t, jsplugin.RouteTypeDynamic, routes["POST /tencentmps"].Type)
}

func TestTencentMPSSubmitRequestIsSignedWithTC3(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	const secretID = "AKIDtestsecretid"
	const secretKey = "testsecretkey"
	const region = "ap-guangzhou"
	const prompt = "a paper boat on a river"

	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"model":       "hunyuan-image",
		"requestBody": map[string]any{"prompt": prompt},
		"apiKey":      secretID + "|" + secretKey + "|" + region,
	})
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var request map[string]any
	require.NoError(t, common.Unmarshal(encoded, &request))

	assert.Equal(t, "https://mps.tencentcloudapi.com/", request["url"])
	assert.Equal(t, "POST", request["method"])

	body, ok := request["body"].(string)
	require.True(t, ok, "the vendor body is sent as the exact signed string")
	assert.Contains(t, body, `"ModelName":"Hunyuan"`)
	assert.Contains(t, body, `"Prompt":"a paper boat on a river"`)

	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CreateAigcImageTask", headers["X-TC-Action"])
	assert.Equal(t, "2019-06-12", headers["X-TC-Version"])
	assert.Equal(t, region, headers["X-TC-Region"])
	assert.NotContains(t, headers, "Host", "the transport owns the Host header")
	assert.Equal(t, "application/json", headers["Content-Type"])
	requestHeaders := make(map[string]string, len(headers))
	for name, value := range headers {
		requestHeaders[name] = common.Interface2String(value)
	}
	require.NoError(t, jsplugin.ValidateRequestHeaders(requestHeaders))

	// The timestamp the plugin signed with must produce the reference
	// signature over the same body.
	timestampText, ok := headers["X-TC-Timestamp"].(string)
	require.True(t, ok)
	timestamp, err := strconv.ParseInt(timestampText, 10, 64)
	require.NoError(t, err)

	authorization, ok := headers["Authorization"].(string)
	require.True(t, ok)
	expected := tc3ReferenceSignature(secretID, secretKey, "mps.tencentcloudapi.com", "CreateAigcImageTask", body, timestamp)
	assert.Equal(t, expected, authorization)
}

func TestTencentMPSParsesTheWrappedSubmitResponse(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	result := callPlugin(t, plugin, "parseSubmitResponse",
		map[string]any{"model": "hunyuan-image", "requestBody": map[string]any{"prompt": "cat"}},
		map[string]any{
			"statusCode": 200,
			"headers":    map[string]any{},
			"body": map[string]any{"Response": map[string]any{
				"TaskId":    "4-AigcImage-abc",
				"RequestId": "request-id",
			}},
		},
	)
	assert.Equal(t, "4-AigcImage-abc", result["taskId"])
	require.NotNil(t, result["taskData"])
}

func TestTencentMPSQueryRequestTargetsTheDescribeAction(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	value, err := plugin.Engine.Call(t.Context(), "buildQueryRequest", map[string]any{
		"model":   "hunyuan-image",
		"taskId":  "4-AigcImage-abc",
		"apiKey":  "id|key",
		"baseUrl": "https://mps.tencentcloudapi.com",
	})
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var request map[string]any
	require.NoError(t, common.Unmarshal(encoded, &request))

	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeAigcImageTask", headers["X-TC-Action"])

	body, ok := request["body"].(string)
	require.True(t, ok)
	assert.JSONEq(t, `{"TaskId":"4-AigcImage-abc"}`, body)
}

func TestTencentMPSImageRequestMapsDocumentedFieldsAndChannelAlias(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	decoded, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
		"model":     "customer-image-alias",
		"operation": "edit",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model":  "customer-image-alias",
			"prompt": "turn the subject into a paper sculpture",
			"images": []any{
				map[string]any{"url": "https://assets.example/subject.png", "reference_type": "asset"},
				"https://assets.example/style.png",
			},
			"n":                     2,
			"enhance_prompt":        false,
			"extra_parameters":      map[string]any{"aspect_ratio": "1:1", "resolution": "2K", "output_format": "png", "logo_add": 0},
			"additional_parameters": map[string]any{"previous_task_id": "4-AigcImage-previous"},
			"store_cos_param":       map[string]any{"bucket_name": "bucket-123", "bucket_region": "ap-guangzhou", "bucket_path": "images"},
			"operator":              "admin",
		}},
	})
	require.NoError(t, err)
	decodedIntent, ok := decoded.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "customer-image-alias", decodedIntent["model"])
	assert.Equal(t, "image_to_image", decodedIntent["action"])

	requestBody, ok := decodedIntent["requestBody"].(map[string]any)
	require.True(t, ok)
	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model":         "customer-image-alias",
		"upstreamModel": "kling-image-3.0-omni",
		"requestBody":   requestBody,
		"apiKey":        "id|key",
	})
	body, ok := request["body"].(string)
	require.True(t, ok)
	var payload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(body, &payload))
	assert.Equal(t, "Kling", payload["ModelName"])
	assert.Equal(t, "3.0-Omni", payload["ModelVersion"])
	assert.Equal(t, float64(2), payload["OutputImageCount"])
	assert.Equal(t, false, payload["EnhancePrompt"])
	assert.Equal(t, "admin", payload["Operator"])
	assert.JSONEq(t, `{"previous_task_id":"4-AigcImage-previous"}`, common.Interface2String(payload["AdditionalParameters"]))

	images, ok := payload["ImageInfos"].([]any)
	require.True(t, ok)
	require.Len(t, images, 2)
	first, ok := images[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "https://assets.example/subject.png", first["ImageUrl"])
	assert.Equal(t, "asset", first["ReferenceType"])

	extra, ok := payload["ExtraParameters"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "1:1", extra["AspectRatio"])
	assert.Equal(t, "2K", extra["Resolution"])
	assert.Equal(t, "png", extra["OutputFormat"])
	assert.Equal(t, float64(0), extra["LogoAdd"])

	store, ok := payload["StoreCosParam"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "bucket-123", store["CosBucketName"])
	assert.Equal(t, "ap-guangzhou", store["CosBucketRegion"])
	assert.Equal(t, "images", store["CosBucketPath"])
}

func TestTencentMPSNativeSDKOptionalEnhancePrompt(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)
	for _, kind := range []string{"Image", "Video"} {
		for _, tc := range []struct {
			name    string
			value   any
			invalid bool
		}{
			{name: "unset", value: nil},
			{name: "disabled", value: false},
			{name: "enabled", value: true},
			{name: "string", value: "false", invalid: true},
			{name: "number", value: 0, invalid: true},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				decoded := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
					"requestHeaders": map[string]any{"X-TC-Action": "CreateAigc" + kind + "Task"},
					"body": map[string]any{"kind": "json", "value": map[string]any{
						"ModelName": "Hunyuan", "Prompt": "a blue cup", "EnhancePrompt": tc.value,
					}},
				})
				value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
					"model": decoded["model"], "requestBody": decoded["requestBody"], "apiKey": "test-id|test-secret",
				})
				if tc.invalid {
					require.ErrorContains(t, err, "enhance_prompt must be a boolean")
					return
				}
				require.NoError(t, err)
				var descriptor map[string]any
				require.NoError(t, common.UnmarshalJsonStr(mustJSON(t, value), &descriptor))
				var payload map[string]any
				require.NoError(t, common.UnmarshalJsonStr(descriptor["body"].(string), &payload))
				if tc.value == nil {
					assert.NotContains(t, payload, "EnhancePrompt")
				} else {
					assert.Equal(t, tc.value, payload["EnhancePrompt"])
				}
			})
		}
	}
}

func TestTencentMPSNativeImageRouteMapsCreateAndQuery(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	created := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{
			"X-Tc-Action":  "CreateAigcImageTask",
			"X-Tc-Version": "2019-06-12",
		},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"ModelName":        "Kling",
			"ModelVersion":     "3.0-Omni",
			"Prompt":           "combine the references",
			"OutputImageCount": 2,
			"ImageInfos": []any{
				map[string]any{"ImageUrl": "https://assets.example/one.png", "ReferenceType": "asset"},
				map[string]any{"Url": "https://assets.example/two.png"},
			},
			"AdditionalParameters": `{"size":"2048x2048"}`,
			"ExtraParameters":      map[string]any{"Resolution": "2K", "OutputFormat": "png"},
			"StoreCosParam": map[string]any{
				"CosBucketName":   "bucket-123",
				"CosBucketRegion": "ap-guangzhou",
			},
			"Operator": "native-user",
		}},
	})
	assert.Equal(t, "submit", created["kind"])
	assert.Equal(t, "kling-image-3.0-omni", created["model"])
	assert.Equal(t, "image_to_image", created["action"])
	requestBody, ok := created["requestBody"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, float64(2), requestBody["n"])
	assert.Equal(t, "native-user", requestBody["operator"])

	query := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "DescribeAigcImageTask"},
		"body":           map[string]any{"kind": "json", "value": map[string]any{"TaskId": "task-public"}},
	})
	assert.Equal(t, "query", query["kind"])
	assert.Equal(t, []any{"task-public"}, query["taskIds"])

	submitted := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"},
		map[string]any{},
		map[string]any{
			"task_id": "task-public",
			"status":  "SUBMITTED",
			"data": map[string]any{"Response": map[string]any{
				"TaskId": "private-upstream-id", "RequestId": "request-create",
			}},
		},
	)
	assert.JSONEq(t, `{"Response":{"TaskId":"task-public","RequestId":"request-create"}}`, mustJSON(t, submitted))

	described := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"},
		map[string]any{},
		[]any{map[string]any{
			"task_id": "task-public",
			"status":  "SUCCESS",
			"data": map[string]any{"Response": map[string]any{
				"Status": "DONE", "RequestId": "request-query", "ImageUrls": []any{"https://cos.example/result.png"},
			}},
		}},
	)
	assert.JSONEq(t, `{"Response":{"Status":"DONE","RequestId":"request-query","ImageUrls":["https://cos.example/result.png"]}}`, mustJSON(t, described))
}

func TestTencentMPSNativeVideoRouteMapsCreateQueryAndResult(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	created := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{
			"X-TC-Action":  "CreateAigcVideoTask",
			"X-TC-Version": "2019-06-12",
		},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"ModelName":      "Kling",
			"ModelVersion":   "3.0-Omni",
			"SceneType":      "motion_control",
			"Prompt":         "move the subject",
			"NegativePrompt": "bright colors",
			"EnhancePrompt":  false,
			"ImageUrl":       "https://assets.example/first.png",
			"LastImageUrl":   "https://assets.example/last.png",
			"ImageInfos": []any{
				map[string]any{"ImageUrl": "https://assets.example/one.png", "ReferenceType": "asset", "Text": "subject"},
				map[string]any{"ImageUrl": "https://assets.example/two.png"},
			},
			"VideoInfos": []any{
				map[string]any{"VideoUrl": "https://assets.example/reference.mp4", "ReferType": "feature", "KeepOriginalSound": "yes"},
			},
			"AudioInfos": []any{
				map[string]any{"AudioUrl": "https://assets.example/reference.mp3"},
			},
			"SubjectInfos": []any{
				map[string]any{
					"Id": "subject-1", "Name": "dog", "VoiceId": "voice-1",
					"ImageUrls": []any{"https://assets.example/subject.png"},
					"VideoUrls": []any{"https://assets.example/subject.mp4"},
				},
			},
			"Duration": 10,
			"ExtraParameters": map[string]any{
				"Resolution": "1080P", "AspectRatio": "16:9", "LogoAdd": 0,
				"EnableAudio": true, "EnableBgm": false, "OffPeak": false,
			},
			"AdditionalParameters": `{"camera_control":{"type":"simple"}}`,
			"StoreCosParam": map[string]any{
				"CosBucketName": "bucket-123", "CosBucketRegion": "ap-guangzhou", "CosBucketPath": "videos",
			},
			"Operator": "native-user",
		}},
	})
	assert.Equal(t, "submit", created["kind"])
	assert.Equal(t, "kling-video-3.0-omni", created["model"])
	assert.Equal(t, "video_to_video", created["action"])

	requestBody, ok := created["requestBody"].(map[string]any)
	require.True(t, ok)
	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": created["model"], "requestBody": requestBody, "apiKey": "id|key",
	})
	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CreateAigcVideoTask", headers["X-TC-Action"])
	body, ok := request["body"].(string)
	require.True(t, ok)
	var payload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(body, &payload))
	assert.Equal(t, "Kling", payload["ModelName"])
	assert.Equal(t, "3.0-Omni", payload["ModelVersion"])
	assert.Equal(t, float64(10), payload["Duration"])
	assert.Equal(t, false, payload["EnhancePrompt"])
	assert.Equal(t, "native-user", payload["Operator"])
	assert.JSONEq(t, `{"camera_control":{"type":"simple"}}`, common.Interface2String(payload["AdditionalParameters"]))
	require.Len(t, payload["ImageInfos"], 2)
	require.Len(t, payload["VideoInfos"], 1)
	require.Len(t, payload["AudioInfos"], 1)
	require.Len(t, payload["SubjectInfos"], 1)
	extra, ok := payload["ExtraParameters"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, extra["EnableBgm"])
	assert.Equal(t, false, extra["OffPeak"])

	query := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "DescribeAigcVideoTask"},
		"body":           map[string]any{"kind": "json", "value": map[string]any{"TaskId": "task-video"}},
	})
	assert.Equal(t, "query", query["kind"])
	assert.Equal(t, []any{"task-video"}, query["taskIds"])

	described := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"},
		map[string]any{},
		[]any{map[string]any{
			"task_id": "task-video",
			"status":  "SUCCESS",
			"data": map[string]any{"Response": map[string]any{
				"Status": "DONE", "RequestId": "request-query", "Resolution": "1920x1088",
				"VideoUrls": []any{"https://cos.example/result.mp4"}, "Message": "ok",
			}},
		}},
	)
	assert.JSONEq(t, `{"Response":{"Status":"DONE","RequestId":"request-query","VideoUrls":["https://cos.example/result.mp4"],"Resolution":"1920x1088","Message":"ok"}}`, mustJSON(t, described))
}

func TestTencentMPSNativeAudioRouteMapsCreateQueryAndResult(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	created := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{
			"X-TC-Action":  "CreateAigcAudioTask",
			"X-TC-Version": "2019-06-12",
		},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"ModelName":         "MiniMaxMusic",
			"ModelVersion":      "2.6",
			"SceneType":         "music",
			"Prompt":            "生成一段轻快的音乐",
			"OutputAudioFormat": "mp3",
			"VideoInfos": []any{
				map[string]any{"VideoUrl": "https://assets.example/reference.mp4"},
			},
			"AudioInfos": []any{
				map[string]any{"Type": "Url", "Url": "https://assets.example/reference.wav"},
			},
			"ExtraParameters":      map[string]any{"ResourceId": "resource-1"},
			"AdditionalParameters": `{"n":2,"lyrics":"test"}`,
			"StoreCosParam": map[string]any{
				"CosBucketName":   "bucket-123",
				"CosBucketRegion": "ap-guangzhou",
			},
			"Operator": "native-user",
		}},
	})
	assert.Equal(t, "submit", created["kind"])
	assert.Equal(t, "minimax-music-2.6", created["model"])
	assert.Equal(t, "audio_to_audio", created["action"])

	requestBody, ok := created["requestBody"].(map[string]any)
	require.True(t, ok)
	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model":       created["model"],
		"requestBody": requestBody,
		"apiKey":      "id|key",
	})
	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CreateAigcAudioTask", headers["X-TC-Action"])
	body, ok := request["body"].(string)
	require.True(t, ok)
	var payload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(body, &payload))
	assert.Equal(t, "MiniMaxMusic", payload["ModelName"])
	assert.Equal(t, "2.6", payload["ModelVersion"])
	assert.Equal(t, "mp3", payload["OutputAudioFormat"])
	assert.Equal(t, "native-user", payload["Operator"])
	assert.JSONEq(t, `{"n":2,"lyrics":"test"}`, common.Interface2String(payload["AdditionalParameters"]))
	require.Len(t, payload["VideoInfos"], 1)
	require.Len(t, payload["AudioInfos"], 1)
	audioInfos, ok := payload["AudioInfos"].([]any)
	require.True(t, ok)
	audioInfo, ok := audioInfos[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "https://assets.example/reference.wav", audioInfo["AudioUrl"])

	query := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "DescribeAigcAudioTask"},
		"body":           map[string]any{"kind": "json", "value": map[string]any{"TaskId": "task-audio"}},
	})
	assert.Equal(t, "query", query["kind"])
	assert.Equal(t, []any{"task-audio"}, query["taskIds"])

	queryRequest := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"model": "minimax-music-2.6", "taskId": "task-audio", "apiKey": "id|key",
	})
	queryHeaders, ok := queryRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeAigcAudioTask", queryHeaders["X-TC-Action"])

	result := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "minimax-music-2.6"},
		map[string]any{"Response": map[string]any{
			"Status": "DONE",
			"AudioInfos": []any{
				map[string]any{"Url": "https://cos.example/one.mp3", "Duration": 90},
				map[string]any{"Url": "https://cos.example/two.mp3", "Duration": 95},
			},
			"VideoInfos": []any{map[string]any{"Url": "https://cos.example/video.mp4", "Duration": 95}},
		}},
	)
	assert.Equal(t, "SUCCESS", result["status"])
	assert.Equal(t, "https://cos.example/one.mp3", result["url"])
	require.Len(t, result["audioInfos"], 2)

	described := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"},
		map[string]any{},
		[]any{map[string]any{
			"task_id": "task-audio",
			"status":  "SUCCESS",
			"data": map[string]any{"Response": map[string]any{
				"RequestId":  "request-query",
				"AudioInfos": []any{map[string]any{"Url": "https://cos.example/result.mp3", "Duration": 90}},
				"VideoInfos": []any{map[string]any{"Url": "https://cos.example/result.mp4", "Duration": 90}},
			}},
		}},
	)
	assert.JSONEq(t, `{"Response":{"Status":"DONE","RequestId":"request-query","AudioInfos":[{"Url":"https://cos.example/result.mp3","Duration":90}],"VideoInfos":[{"Url":"https://cos.example/result.mp4","Duration":90}]}}`, mustJSON(t, described))
}

func TestTencentMPSNativeMultimodalUnderstandingRouteMapsProcessAndResult(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)
	extended := `{"mvc":{"model":"wand-vega-vl-1.0-pro","prompt":"概括两段视频的内容","extendData":[{"url":"https://assets.example/input2.mp4"}]}}`

	created := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{
			"X-TC-Action":  "ProcessMedia",
			"X-TC-Version": "2019-06-12",
		},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"Action":  "ProcessMedia",
			"Version": "2019-06-12",
			"InputInfo": map[string]any{
				"Type": "URL",
				"UrlInputInfo": map[string]any{
					"Url": "https://assets.example/input1.mp4",
				},
			},
			"AiAnalysisTask": map[string]any{
				"Definition":        33,
				"ExtendedParameter": extended,
			},
			"OutputStorage": map[string]any{
				"CosOutputStorage": map[string]any{"Bucket": "mps-1234567890", "Region": "ap-guangzhou"},
			},
		}},
	})
	assert.Equal(t, "submit", created["kind"])
	assert.Equal(t, "wand-vega-vl-1.0-pro-media", created["model"])
	assert.Equal(t, "multimodal_understanding", created["action"])

	requestBody, ok := created["requestBody"].(map[string]any)
	require.True(t, ok)
	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": created["model"], "requestBody": requestBody, "apiKey": "id|key",
	})
	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "ProcessMedia", headers["X-TC-Action"])
	body, ok := request["body"].(string)
	require.True(t, ok)
	var payload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(body, &payload))
	assert.NotContains(t, payload, "Action")
	assert.NotContains(t, payload, "Version")
	analysis, ok := payload["AiAnalysisTask"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, float64(33), analysis["Definition"])
	assert.JSONEq(t, extended, common.Interface2String(analysis["ExtendedParameter"]))

	usage := callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": created["model"], "requestBody": requestBody,
	})
	assert.Equal(t, float64(1), usage["analysis_count"])

	query := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "DescribeTaskDetail"},
		"body":           map[string]any{"kind": "json", "value": map[string]any{"TaskId": "task-analysis"}},
	})
	assert.Equal(t, "query", query["kind"])
	assert.Equal(t, []any{"task-analysis"}, query["taskIds"])

	queryRequest := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"model": "wand-vega-vl-1.0-pro-media", "taskId": "task-analysis", "apiKey": "id|key",
	})
	queryHeaders, ok := queryRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeTaskDetail", queryHeaders["X-TC-Action"])

	vendorResponse := map[string]any{"Response": map[string]any{
		"TaskType": "WorkflowTask",
		"Status":   "FINISH",
		"WorkflowTask": map[string]any{
			"ErrCode": 0,
			"Message": "",
			"AiAnalysisResultSet": []any{map[string]any{
				"Type": "VideoComprehension",
				"VideoComprehensionTask": map[string]any{
					"Status": "SUCCESS",
					"Output": map[string]any{"VideoComprehensionAnalysisResult": "视频内容摘要"},
				},
			}},
		},
		"RequestId": "request-query",
	}}
	result := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "wand-vega-vl-1.0-pro-media"}, vendorResponse,
	)
	assert.Equal(t, "SUCCESS", result["status"])
	assert.Equal(t, "视频内容摘要", result["text"])

	described := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"},
		map[string]any{},
		[]any{map[string]any{
			"task_id": "task-analysis",
			"status":  "SUCCESS",
			"data":    vendorResponse,
		}},
	)
	assert.JSONEq(t, mustJSON(t, vendorResponse), mustJSON(t, described))
}

func TestTencentMPSNativeScenarioRoutesMapLifecycleAndBilling(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	document := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "CreateDocToVideoTask", "X-TC-Version": "2019-06-12"},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"Input": map[string]any{
				"FileUrl":           []any{"https://assets.example/guide.pptx"},
				"Prompt":            "生成产品介绍视频",
				"ModelName":         "WAND",
				"ModelVersion":      "1.0-lite",
				"Mode":              "stage",
				"Ratio":             "16:9",
				"Language":          "zh",
				"ReferenceDuration": 120,
				"EnableTTS":         true,
				"PPTXFidelity":      true,
				"EnableCaption":     true,
			},
			"ResourceId": "vts-resource-1",
		}},
	})
	assert.Equal(t, "wand-doc-to-video-1.0-lite", document["model"])
	assert.Equal(t, "document_to_video", document["action"])

	documentRequest := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": document["model"], "requestBody": document["requestBody"], "apiKey": "id|key",
	})
	documentHeaders, ok := documentRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CreateDocToVideoTask", documentHeaders["X-TC-Action"])
	var documentPayload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(common.Interface2String(documentRequest["body"]), &documentPayload))
	assert.Equal(t, "vts-resource-1", documentPayload["ResourceId"])
	assert.Equal(t, map[string]any{"scenario_count": float64(1)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": document["model"], "requestBody": document["requestBody"],
	}))

	control := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "ModifyDocToVideoTaskStatus"},
		"body": map[string]any{"kind": "json", "value": map[string]any{"Input": map[string]any{
			"Action": "regenerate", "Stage": "STAGE_1", "SourceTaskId": "task-public",
			"Regenerate": map[string]any{"Scope": "scenes", "Prompt": "合并前两页", "SceneIds": []any{"scene-1", "scene-2"}},
		}}},
	})
	assert.Equal(t, "tencentmps-doc-to-video-control", control["model"])
	assert.Equal(t, []any{"task-public"}, control["originTaskIds"])
	controlRequest := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": control["model"], "requestBody": control["requestBody"], "apiKey": "id|key",
		"originTasks": []any{map[string]any{"taskId": "task-public", "upstreamTaskId": "task-private", "action": "document_to_video"}},
	})
	controlHeaders, ok := controlRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "ModifyDocToVideoTaskStatus", controlHeaders["X-TC-Action"])
	var controlPayload map[string]any
	require.NoError(t, common.UnmarshalJsonStr(common.Interface2String(controlRequest["body"]), &controlPayload))
	controlInput, ok := controlPayload["Input"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "task-private", controlInput["SourceTaskId"])
	assert.Equal(t, map[string]any{"scenario_count": float64(1)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": control["model"], "requestBody": control["requestBody"],
	}))
	assert.Empty(t, callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": control["model"]},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"Response": map[string]any{"TaskStatus": "FINISHED"}},
	))

	fission := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "CreateAiFissionTask"},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"Input": map[string]any{"ImageUrls": []any{"https://assets.example/product.png"}, "Text": "介绍商品"},
			"TaskInfo": map[string]any{
				"Duration": 15, "ModelTier": "flagship", "Ratio": "9:16", "Resolution": "1080p",
				"Market": "china", "Language": "chinese", "VideoType": "ugc", "SplitCount": 1,
			},
		}},
	})
	assert.Equal(t, "tencentmps-video-fission-flagship", fission["model"])
	fissionRequest := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": fission["model"], "requestBody": fission["requestBody"], "apiKey": "id|key",
	})
	fissionHeaders, ok := fissionRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CreateAiFissionTask", fissionHeaders["X-TC-Action"])
	assert.Equal(t, map[string]any{"seconds": float64(15)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": fission["model"], "requestBody": fission["requestBody"],
	}))

	viral := callPluginPath(t, plugin, "native", []string{"mpsTask"}, map[string]any{
		"requestHeaders": map[string]any{"X-TC-Action": "CloneViral"},
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"Mode": "motion", "VideoUrl": "https://assets.example/reference.mp4",
			"Persona":   map[string]any{"Images": []any{"https://assets.example/person.png"}},
			"Reference": map[string]any{"Backgrounds": []any{"https://assets.example/background.png"}},
			"AIGCParam": map[string]any{"ModelTier": "pro", "Resolution": "1080p", "AspectRatio": "16:9"},
		}},
	})
	assert.Equal(t, "tencentmps-viral-clone-pro", viral["model"])
	viralRequest := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": viral["model"], "requestBody": viral["requestBody"], "apiKey": "id|key",
	})
	viralHeaders, ok := viralRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "CloneViral", viralHeaders["X-TC-Action"])
	assert.Equal(t, map[string]any{"scenario_count": float64(1)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": viral["model"], "requestBody": viral["requestBody"],
	}))

	documentQuery := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"model": "wand-doc-to-video-1.0", "taskId": "task-private", "apiKey": "id|key",
	})
	documentQueryHeaders, ok := documentQuery["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeAigcTaskStatus", documentQueryHeaders["X-TC-Action"])
	viralQuery := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"model": viral["model"], "taskId": "task-private", "apiKey": "id|key",
	})
	viralQueryHeaders, ok := viralQuery["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeCloneViralTask", viralQueryHeaders["X-TC-Action"])

	documentResult := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "wand-doc-to-video-1.0"},
		map[string]any{"Response": map[string]any{
			"TaskStatus": "FINISHED", "OutputUrl": "https://cos.example/document.mp4", "TaskType": "DocGenVideo",
		}},
	)
	assert.Equal(t, "SUCCESS", documentResult["status"])
	assert.Equal(t, "https://cos.example/document.mp4", documentResult["outputUrl"])
	viralResult := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": viral["model"]},
		map[string]any{"Response": map[string]any{"Status": "DONE", "VideoUrls": []any{"https://cos.example/viral.mp4"}}},
	)
	assert.Equal(t, "SUCCESS", viralResult["status"])

	described := callPluginPath(t, plugin, "native", []string{"mpsTaskResult"}, map[string]any{}, []any{map[string]any{
		"task_id": "task-public", "status": "SUCCESS",
		"properties": map[string]any{"origin_model_name": "wand-doc-to-video-1.0"},
		"data": map[string]any{"Response": map[string]any{
			"TaskId": "task-public", "TaskStatus": "FINISHED", "TaskType": "DocGenVideo",
			"OutputUrl": "https://cos.example/document.mp4", "RequestId": "request-query",
		}},
	}})
	assert.JSONEq(t, `{"Response":{"TaskId":"task-public","TaskStatus":"FINISHED","TaskType":"DocGenVideo","OutputUrl":"https://cos.example/document.mp4","RequestId":"request-query"}}`, mustJSON(t, described))

	for _, tc := range []struct {
		name   string
		action string
		body   map[string]any
		want   string
	}{
		{name: "document prompt", action: "CreateDocToVideoTask", body: map[string]any{"Input": map[string]any{"FileUrl": []any{"https://assets.example/a.pdf"}, "Prompt": strings.Repeat("文", 2001)}}, want: "must not exceed 2000"},
		{name: "fission duration", action: "CreateAiFissionTask", body: map[string]any{"Input": map[string]any{"ImageUrls": []any{"https://assets.example/a.png"}}, "TaskInfo": map[string]any{"Duration": 16}}, want: "between 4 and 15"},
		{name: "viral flash duration", action: "CloneViral", body: map[string]any{"VideoUrl": "https://assets.example/a.mp4", "Product": map[string]any{"Images": []any{"https://assets.example/a.png"}}, "AIGCParam": map[string]any{"Duration": 16}}, want: "between 2 and 15"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := plugin.Engine.CallPath(t.Context(), "native", []string{"mpsTask"}, map[string]any{
				"requestHeaders": map[string]any{"X-TC-Action": tc.action},
				"body":           map[string]any{"kind": "json", "value": tc.body},
			})
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.want)
		})
	}
}

func TestTencentTokenHubVegaNativeRouteMapsRequestAndTaskResponses(t *testing.T) {
	plugin := loadTencentTokenHubPlugin(t)

	for _, model := range []string{
		"hy-image-v3.5-preview",
		"kling-image-v3-omni",
		"seedream-image-v5.0-pro",
		"wand-vega-video-1.0-lite",
		"minimax-video-h3",
		"kling-video-v4",
		"vidu-video-q4-preview",
		"pixverse-video-v6.0",
		"hy-video-1.5",
		"yt-video-fx",
		"hy-world2-scene",
		"hy-3d-3.1",
		"tripo-3d-p2",
		"hi3d-3.0",
		"rodin-gen-3d-2.5",
		"minimax-music-v2.6",
		"minimax-speech-2.8-hd",
		"wand-dubbing-clone-v2",
		"tenlai-asr-v1.0",
		"hy-asr-3.0-preview",
	} {
		assert.Contains(t, plugin.Meta.Models, model)
	}

	routes := make(map[string]jsplugin.Route, len(plugin.Meta.Routes))
	for _, route := range plugin.Meta.Routes {
		routes[route.Method+" "+route.Path] = route
	}
	require.Contains(t, routes, "POST /v1/wand/vega-images/generations")
	assert.Equal(t, jsplugin.RouteTypeSubmit, routes["POST /v1/wand/vega-images/generations"].Type)
	require.Contains(t, routes, "GET /v1/wand/vega-images/tasks/:task_id")
	assert.Equal(t, jsplugin.RouteTypeQuery, routes["GET /v1/wand/vega-images/tasks/:task_id"].Type)

	decoded := callPluginPath(t, plugin, "native", []string{"vegaImage"}, map[string]any{
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model":  "wand-vega-image-flash",
			"prompt": "a detailed butterfly",
			"size":   "2048x2048",
			"input": []any{map[string]any{"content": []any{
				map[string]any{"type": "input_image", "image_url": "https://assets.example/reference.png"},
			}}},
		}},
	})
	assert.Equal(t, "submit", decoded["kind"])
	assert.Equal(t, "wand-vega-image-flash", decoded["model"])
	assert.Equal(t, "image_to_image", decoded["action"])
	requestBody, ok := decoded["requestBody"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "2048x2048", requestBody["size"])

	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model":       "wand-vega-image-flash",
		"requestBody": requestBody,
		"baseUrl":     "https://tokenhub.tencentmaas.com",
		"authHeader":  "tokenhub-key",
		"apiKey":      "tokenhub-key",
	})
	assert.Equal(t, "https://tokenhub.tencentmaas.com/v1/wand/vega-images/generations", request["url"])
	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "Bearer tokenhub-key", headers["Authorization"])
	requestPayload, ok := request["body"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "wand-vega-image-flash", requestPayload["model"])
	assert.Equal(t, requestBody["input"], requestPayload["input"])

	queryRequest := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"taskId":     "task-upstream",
		"baseUrl":    "https://tokenhub.tencentmaas.com",
		"authHeader": "Bearer tokenhub-key",
	})
	assert.Equal(t, "https://tokenhub.tencentmaas.com/v1/wand/vega-images/tasks/task-upstream", queryRequest["url"])
	queryHeaders, ok := queryRequest["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "Bearer tokenhub-key", queryHeaders["Authorization"])

	submitted := callPluginPath(t, plugin, "native", []string{"imageSubmitted"},
		map[string]any{},
		map[string]any{
			"task_id": "task-public",
			"data":    map[string]any{"task_id": "task-upstream", "request_id": "request-create"},
		},
	)
	assert.JSONEq(t, `{"task_id":"task-public","request_id":"request-create"}`, mustJSON(t, submitted))

	completed := callPluginPath(t, plugin, "native", []string{"imageTask"},
		map[string]any{},
		map[string]any{
			"task_id":     "task-public",
			"status":      "SUCCESS",
			"created_at":  100,
			"finish_time": 120,
			"data": map[string]any{
				"task_id": "task-upstream", "status": "completed", "request_id": "request-query",
				"created_at": 100, "finished_at": 120,
				"data":  []any{map[string]any{"url": "https://cos.example/result.png"}},
				"usage": map[string]any{"total_tokens": 16200},
			},
		},
	)
	assert.JSONEq(t, `{"task_id":"task-public","status":"completed","request_id":"request-query","created_at":100,"finished_at":120,"data":[{"url":"https://cos.example/result.png"}],"usage":{"total_tokens":16200}}`, mustJSON(t, completed))

	usage := callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": "wand-vega-image-flash"},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"usage": map[string]any{"total_tokens": 16200}},
	)
	assert.Equal(t, float64(16200), usage["tokens"])
	assert.Equal(t, map[string]any{"tokens": float64(77500)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model":       "wand-vega-image-flash",
		"requestBody": requestBody,
	}))
	assert.Equal(t, map[string]any{"tokens": float64(181000)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": "wand-vega-image-pro",
		"requestBody": map[string]any{"input": []any{map[string]any{"content": []any{
			map[string]any{"type": "input_image", "image_url": "https://assets.example/1.png"},
			map[string]any{"type": "input_image", "image_url": "https://assets.example/2.png"},
			map[string]any{"type": "input_image", "image_url": "https://assets.example/3.png"},
			map[string]any{"type": "input_image", "image_url": "https://assets.example/4.png"},
		}}}},
	}))

	parsed := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{},
		map[string]any{
			"status": "completed",
			"data":   []any{map[string]any{"url": "https://cos.example/result.png"}},
			"usage":  map[string]any{"total_tokens": 16200},
		},
	)
	assert.Equal(t, "SUCCESS", parsed["status"])
	assert.Equal(t, []any{"https://cos.example/result.png"}, parsed["imageUrls"])

	invalidUsage, err := plugin.Engine.Call(t.Context(), "extractUsageOnComplete",
		map[string]any{"model": "wand-vega-image-flash"},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"usage": map[string]any{"total_tokens": 2147483648}},
	)
	require.NoError(t, err)
	assert.Nil(t, invalidUsage)
}

func TestTencentTokenHubCatalogRoutesRelayNativeTasksAndBillingFacts(t *testing.T) {
	plugin := loadTencentTokenHubPlugin(t)

	routes := make(map[string]jsplugin.Route, len(plugin.Meta.Routes))
	for _, route := range plugin.Meta.Routes {
		routes[route.Method+" "+route.Path] = route
	}
	for _, route := range []string{
		"POST /v1/wand/hunyuan-image/v35-generation",
		"POST /v1/wand/kling/text-to-video",
		"GET /v1/wand/kling/tasks/:task_id",
		"POST /v1/api/3d/submit",
		"POST /v1/api/3d/query",
		"POST /v1/wand/minimax-tts/sync-tts",
		"POST /v1/wand/dubbing/async_generation",
	} {
		require.Contains(t, routes, route)
	}
	for _, model := range []string{"miora-3d", "miora-3d-1.2", "miora-3d-t1", "wand-dubbing-sts-v1"} {
		assert.Contains(t, plugin.Meta.Models, model)
	}

	decoded := callPluginPath(t, plugin, "native", []string{"catalogTask"}, map[string]any{
		"path": "/v1/wand/kling/text-to-video",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model": "kling-video-v4", "prompt": "a robot walking", "duration": 5,
		}},
	})
	assert.Equal(t, "submit", decoded["kind"])
	assert.Equal(t, "catalog:kling_text_video", decoded["action"])

	request := callPlugin(t, plugin, "buildSubmitRequest", map[string]any{
		"model": "kling-video-v4", "action": decoded["action"], "requestBody": decoded["requestBody"],
		"baseUrl": "https://tokenhub.tencentmaas.com", "authHeader": "tokenhub-key",
	})
	assert.Equal(t, "https://tokenhub.tencentmaas.com/v1/wand/kling/text-to-video", request["url"])
	assert.Equal(t, "Bearer tokenhub-key", request["headers"].(map[string]any)["Authorization"])

	submitted := callPlugin(t, plugin, "parseSubmitResponse",
		map[string]any{"model": "kling-video-v4", "action": decoded["action"]},
		map[string]any{"body": map[string]any{"task_id": "task-upstream"}},
	)
	assert.Equal(t, "task-upstream", submitted["taskId"])

	query := callPlugin(t, plugin, "buildQueryRequest", map[string]any{
		"model": "kling-video-v4", "action": decoded["action"], "taskId": "task-upstream",
		"baseUrl": "https://tokenhub.tencentmaas.com", "authHeader": "Bearer tokenhub-key",
	})
	assert.Equal(t, "https://tokenhub.tencentmaas.com/v1/wand/kling/tasks/task-upstream", query["url"])
	assert.Equal(t, "GET", query["method"])

	completed := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "kling-video-v4", "action": decoded["action"]},
		map[string]any{
			"status": "succeeded", "result": map[string]any{"video_url": "https://cos.example/video.mp4"},
			"usage": map[string]any{"total_tokens": 42000},
		},
	)
	assert.Equal(t, "SUCCESS", completed["status"])
	assert.Equal(t, "https://cos.example/video.mp4", completed["url"])
	assert.Equal(t, map[string]any{"tokens": float64(42000)}, callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": "kling-video-v4", "action": decoded["action"]},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"usage": map[string]any{"total_tokens": 42000}},
	))

	assert.Equal(t, map[string]any{"seconds": float64(8)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": "yt-video-2.0", "action": "catalog:yt_video",
		"requestBody": map[string]any{"model": "yt-video-2.0", "duration": 8},
	}))
	assert.Equal(t, map[string]any{"generation_count": float64(1)}, callPlugin(t, plugin, "extractUsage", map[string]any{
		"model": "miora-3d", "action": "catalog:three_d", "requestBody": map[string]any{"model": "miora-3d"},
	}))

	synchronous := callPlugin(t, plugin, "parseSubmitResponse",
		map[string]any{"model": "hy-image-v3.5-preview", "action": "catalog:hunyuan_image_v35", "publicTaskId": "task-public"},
		map[string]any{"body": map[string]any{"data": []any{map[string]any{"url": "https://cos.example/image.png"}}}},
	)
	assert.Equal(t, "task-public", synchronous["taskId"])
	immediate, ok := synchronous["immediate"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "SUCCESS", immediate["status"])

	_, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"model": "yt-video-2.0", "action": "catalog:yt_video", "requestBody": map[string]any{"model": "yt-video-2.0"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duration is required")
}

func TestTencentMPSRequestsEnforceBillingAndReferenceBounds(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	for _, tc := range []struct {
		name  string
		model string
		body  map[string]any
		want  string
	}{
		{name: "fractional output count", model: "hunyuan-image", body: map[string]any{"prompt": "cat", "n": 1.5}, want: "n must be an integer"},
		{name: "oversized output count", model: "hunyuan-image", body: map[string]any{"prompt": "cat", "n": 129}, want: "between 1 and 128"},
		{name: "image prompt length", model: "hunyuan-image", body: map[string]any{"prompt": strings.Repeat("猫", 1001)}, want: "must not exceed 1000 characters"},
		{name: "hunyuan reference limit", model: "hunyuan-image-3.0", body: map[string]any{"images": []any{"https://a/1", "https://a/2", "https://a/3", "https://a/4"}}, want: "at most 3 reference images"},
		{name: "missing prompt and reference", model: "qwen-image-0925", body: map[string]any{}, want: "prompt is required"},
		{name: "fractional audio count", model: "mureka-music-song-9", body: map[string]any{"prompt": "song", "additional_parameters": `{"n":1.5}`}, want: "additional_parameters.n must be an integer"},
		{name: "oversized audio count", model: "mureka-music-song-9", body: map[string]any{"prompt": "song", "additional_parameters": `{"n":129}`}, want: "between 1 and 128"},
		{name: "video reference duration limit", model: "kling-video-3.0-omni", body: map[string]any{
			"prompt": "edit", "duration": 11,
			"video_infos": []any{map[string]any{"url": "https://assets.example/reference.mp4"}},
		}, want: "outside the supported range"},
		{name: "discrete video duration", model: "pixverse-video-v5.6", body: map[string]any{"prompt": "move", "duration": 6}, want: "must be one of 5, 8, 10"},
		{name: "video prompt length", model: "kling-video-3.0", body: map[string]any{"prompt": strings.Repeat("动", 2001)}, want: "must not exceed 2000 characters"},
		{name: "video reference image limit", model: "kling-video-3.0-omni", body: map[string]any{
			"prompt":      "edit",
			"video_infos": []any{map[string]any{"url": "https://assets.example/reference.mp4"}},
			"images": []any{
				"https://assets.example/1.png", "https://assets.example/2.png", "https://assets.example/3.png",
				"https://assets.example/4.png", "https://assets.example/5.png",
			},
		}, want: "at most 4 reference images"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
				"model": tc.model, "requestBody": tc.body, "apiKey": "id|key",
			})
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.want)
		})
	}
}

func TestTencentMPSVideoQueryTargetsTheVideoDescribeAction(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	value, err := plugin.Engine.Call(t.Context(), "buildQueryRequest", map[string]any{
		"model":   "hailuo-video-2.3",
		"taskId":  "2147",
		"apiKey":  "id|key",
		"baseUrl": "https://mps.tencentcloudapi.com",
	})
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var request map[string]any
	require.NoError(t, common.Unmarshal(encoded, &request))

	headers, ok := request["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "DescribeAigcVideoTask", headers["X-TC-Action"])
}

func TestTencentMPSParseTaskResultMapsEveryVendorStatus(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	cases := []struct {
		name       string
		body       map[string]any
		wantStatus string
		wantReason string
	}{
		{
			name:       "waiting",
			body:       map[string]any{"Response": map[string]any{"Status": "WAIT"}},
			wantStatus: "QUEUED",
		},
		{
			name:       "running",
			body:       map[string]any{"Response": map[string]any{"Status": "RUN"}},
			wantStatus: "IN_PROGRESS",
		},
		{
			name: "done",
			body: map[string]any{"Response": map[string]any{
				"Status":    "DONE",
				"ImageUrls": []any{"https://cos.example/a.png"},
			}},
			wantStatus: "SUCCESS",
		},
		{
			name: "failed",
			body: map[string]any{"Response": map[string]any{
				"Status":  "FAIL",
				"Message": "upstream said no",
			}},
			wantStatus: "FAILURE",
			wantReason: "upstream said no",
		},
		{
			name:       "unknown status is not guessed",
			body:       map[string]any{"Response": map[string]any{"Status": "WEIRD"}},
			wantStatus: "UNKNOWN",
			wantReason: "WEIRD",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := callPlugin(t, plugin, "parseTaskResult",
				map[string]any{"model": "hunyuan-image"},
				tc.body,
			)
			assert.Equal(t, tc.wantStatus, result["status"])
			if tc.wantReason != "" {
				assert.Contains(t, common.Interface2String(result["reason"]), tc.wantReason)
			}
		})
	}
}

func TestTencentMPSParseTaskResultReadsTheVendorEnvelope(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	result := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "hunyuan-image"},
		map[string]any{"Response": map[string]any{
			"Status":    "DONE",
			"ImageUrls": []any{"https://cos.example/a.png", "https://cos.example/b.png"},
		}},
	)
	assert.Equal(t, "SUCCESS", result["status"])
	urls, ok := result["imageUrls"].([]any)
	require.True(t, ok)
	assert.Len(t, urls, 2)

	failed := callPlugin(t, plugin, "parseTaskResult",
		map[string]any{"model": "hunyuan-image"},
		map[string]any{"Response": map[string]any{
			"Status":  "FAIL",
			"Message": "upstream said no",
		}},
	)
	assert.Equal(t, "FAILURE", failed["status"])
	assert.Equal(t, "upstream said no", failed["reason"])
}

func TestTencentMPSUsageFactsCountTheProducedOutputs(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	image := callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": "hunyuan-image"},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"Response": map[string]any{
			"Status":    "DONE",
			"ImageUrls": []any{"https://cos.example/a.png", "https://cos.example/b.png"},
		}},
	)
	assert.Equal(t, float64(2), image["image_count"])

	video := callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": "hailuo-video-2.3"},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"Response": map[string]any{"Status": "DONE", "VideoUrls": []any{"https://cos.example/v.mp4"}}},
	)
	_, hasSeconds := video["seconds"]
	assert.False(t, hasSeconds, "the query response has no produced duration, so settlement keeps the reservation")

	videoReserved := callPlugin(t, plugin, "extractUsage",
		map[string]any{"model": "hailuo-video-H3", "requestBody": map[string]any{"prompt": "move"}},
	)
	assert.Equal(t, float64(6), videoReserved["seconds"])

	reserved := callPlugin(t, plugin, "extractUsage",
		map[string]any{"model": "hunyuan-image", "requestBody": map[string]any{"n": 3, "prompt": "a cup"}},
	)
	assert.Equal(t, float64(3), reserved["image_count"])
	assert.Equal(t, "1080P", reserved["resolution"])
	assert.Equal(t, float64(0), reserved["reference_count"])
	for _, tc := range []struct {
		name       string
		body       map[string]any
		resolution string
		references float64
	}{
		{"explicit 4K", map[string]any{"prompt": "a cup", "extra_parameters": map[string]any{"resolution": "4k"}}, "4K", 0},
		{"custom 2K", map[string]any{"prompt": "a cup", "size": "2048x2048"}, "2K", 0},
		{"custom 4K", map[string]any{"prompt": "a cup", "additional_parameters": `{"size":"4096x4096"}`}, "4K", 0},
		{"reference inputs", map[string]any{"prompt": "a cup", "images": []any{"https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png", "https://example.com/4.png"}}, "1080P", 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			facts := callPlugin(t, plugin, "extractUsage", map[string]any{"model": "wand-vega-image-1.0-pro", "requestBody": tc.body})
			assert.Equal(t, tc.resolution, facts["resolution"])
			assert.Equal(t, tc.references, facts["reference_count"])
		})
	}

	audioReserved := callPlugin(t, plugin, "extractUsage",
		map[string]any{"model": "mureka-music-song-9", "requestBody": map[string]any{
			"additional_parameters": `{"n":2}`,
		}},
	)
	assert.Equal(t, float64(2), audioReserved["audio_count"])

	audio := callPlugin(t, plugin, "extractUsageOnComplete",
		map[string]any{"model": "mureka-music-song-9"},
		map[string]any{"status": "SUCCESS"},
		map[string]any{"Response": map[string]any{
			"Status": "DONE",
			"AudioInfos": []any{
				map[string]any{"Url": "https://cos.example/a.mp3", "Duration": 60},
				map[string]any{"Url": "https://cos.example/b.mp3", "Duration": 60},
			},
		}},
	)
	assert.Equal(t, float64(2), audio["audio_count"])
}

func TestTencentMPSImageRendererReadsThePersistedVendorEnvelope(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "render"},
		map[string]any{"operation": "generate"},
		map[string]any{
			"task_id":    "task-public",
			"status":     "SUCCESS",
			"created_at": 123,
			"data": map[string]any{"Response": map[string]any{
				"Status":    "DONE",
				"ImageUrls": []any{"https://cos.example/a.png", "", "https://cos.example/b.webp"},
			}},
		},
	)
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	assert.JSONEq(t, `{"created":123,"data":[{"url":"https://cos.example/a.png"},{"url":"https://cos.example/b.webp"}]}`, string(encoded))
}

func TestTencentMPSRejectsAnUnusableCredential(t *testing.T) {
	plugin := loadTencentMPSPlugin(t)

	_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"model":       "hunyuan-image",
		"requestBody": map[string]any{"prompt": "x"},
		"apiKey":      "single-secret-without-separator",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SecretId|SecretKey")
}
