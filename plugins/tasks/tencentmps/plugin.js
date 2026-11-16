// Tencent Cloud MPS AIGC generation: images, videos, and audio.
//
// The vendor APIs are asynchronous. CreateAigcImageTask and
// CreateAigcVideoTask / CreateAigcAudioTask return a TaskId, and their
// Describe actions report WAIT / RUN / FAIL / DONE. The host's
// openai_image and openai_video protocols poll inside the client request and
// settle the bill, so this plugin only has to speak the vendor's actions and
// report the produced outputs.
//
// Requests carry "<SecretId>|<SecretKey>" or the optional regional form
// "<SecretId>|<SecretKey>|<Region>". The
// Tencent Cloud TC3-HMAC-SHA256 signature needs the plain SHA-256 of the
// payload and of the canonical request, which the host exposes as
// utils.sha256Hex.

// The usage schemas are ordinary module constants: the host executes the
// module before reading meta, so the profiles below can reference them.
const IMAGE_USAGE_SCHEMA = {
  image_count: {
    type: "number",
    unit: "count",
    unitLabel: { en: "image", zh: "张", "zh-TW": "張" },
    description: { en: "Image generation unit price", zh: "图片生成单价" },
  },
  resolution: {
    enum: ["720P", "1080P", "2K", "4K"],
    description: { en: "Output image resolution", zh: "输出图片分辨率" },
  },
  reference_count: {
    type: "number",
    unit: "count",
    description: { en: "Reference image input unit price", zh: "参考图输入单价" },
  },
};

const VIDEO_USAGE_SCHEMA = {
  seconds: {
    type: "number",
    unit: "second",
    description: { en: "Video generation unit price", zh: "视频生成单价" },
  },
};
const AUDIO_USAGE_SCHEMA = {
  audio_count: {
    type: "number",
    unit: "count",
    unitLabel: { en: "audio", zh: "个", "zh-TW": "個" },
    description: { en: "Audio generation unit price", zh: "音频生成单价" },
  },
};
const ANALYSIS_USAGE_SCHEMA = {
  analysis_count: {
    type: "number",
    unit: "count",
    unitLabel: { en: "task", zh: "次", "zh-TW": "次" },
    description: { en: "Multimodal understanding task unit price", zh: "多模态理解任务单价" },
  },
};
const SCENARIO_USAGE_SCHEMA = {
  scenario_count: {
    type: "number",
    unit: "count",
    unitLabel: { en: "task", zh: "次", "zh-TW": "次" },
    description: { en: "AIGC scenario task unit price", zh: "AIGC 场景任务单价" },
  },
};
const IMAGE_USAGE_EXAMPLES = [{ label: "1080P · 1 image", facts: { image_count: 1, resolution: "1080P", reference_count: 0 } }];
const VIDEO_USAGE_EXAMPLES = [{ label: "5s video", facts: { seconds: 5 } }];
const AUDIO_USAGE_EXAMPLES = [{ label: "1 audio", facts: { audio_count: 1 } }];
const ANALYSIS_USAGE_EXAMPLES = [{ label: "1 analysis task", facts: { analysis_count: 1 } }];
const SCENARIO_USAGE_EXAMPLES = [{ label: "1 scenario task", facts: { scenario_count: 1 } }];

// A model without a version uses the vendor's current stable version, so the
// plugin sends no ModelVersion for it. maxReferences follows the limits in
// CreateAigcImageTask; models not called out by that API keep its default of
// one reference image.
const IMAGE_MODELS = {
  "hunyuan-image": { modelName: "Hunyuan", maxReferences: 1 },
  "hunyuan-image-3.5-preview": { modelName: "Hunyuan", modelVersion: "3.5-preview", maxReferences: 5 },
  "hunyuan-image-3.0": { modelName: "Hunyuan", modelVersion: "3.0", maxReferences: 3 },
  "qwen-image": { modelName: "Qwen", maxReferences: 1 },
  "qwen-image-0925": { modelName: "Qwen", modelVersion: "0925", maxReferences: 1 },
  "vidu-image": { modelName: "Vidu", maxReferences: 1 },
  "vidu-image-q2": { modelName: "Vidu", modelVersion: "q2", maxReferences: 7 },
  "kling-image": { modelName: "Kling", maxReferences: 1 },
  "kling-image-2.1": { modelName: "Kling", modelVersion: "2.1", maxReferences: 4 },
  "kling-image-o1": { modelName: "Kling", modelVersion: "O1", maxReferences: 10 },
  "kling-image-3.0": { modelName: "Kling", modelVersion: "3.0", maxReferences: 1 },
  "kling-image-3.0-omni": { modelName: "Kling", modelVersion: "3.0-Omni", maxReferences: 10 },
  "wand-vega-image": { modelName: "wand-vega-image", maxReferences: 10 },
  "wand-vega-image-1.0-lite": { modelName: "wand-vega-image", modelVersion: "1.0-lite", maxReferences: 10 },
  "wand-vega-image-1.0-flash": { modelName: "wand-vega-image", modelVersion: "1.0-flash", maxReferences: 10 },
  "wand-vega-image-1.0-pro": { modelName: "wand-vega-image", modelVersion: "1.0-pro", maxReferences: 10 },
};

const VIDEO_MODELS = {
  "hunyuan-video": { modelName: "Hunyuan", maxReferences: 1, defaultDuration: 5 },
  "hunyuan-video-1.5": { modelName: "Hunyuan", modelVersion: "1.5", maxReferences: 1, defaultDuration: 5 },
  "wand-vega-video": { modelName: "wand-vega-video", maxReferences: 9, defaultDuration: 5, durationMin: 4, durationMax: 15 },
  "wand-vega-video-1.0-lite": { modelName: "wand-vega-video", modelVersion: "1.0-lite", maxReferences: 9, defaultDuration: 5, durationMin: 4, durationMax: 15 },
  "hailuo-video": { modelName: "Hailuo", maxReferences: 1, defaultDuration: 6, durations: [6, 10] },
  "hailuo-video-02": { modelName: "Hailuo", modelVersion: "02", maxReferences: 1, defaultDuration: 6, durations: [6, 10] },
  "hailuo-video-2.3": { modelName: "Hailuo", modelVersion: "2.3", maxReferences: 1, defaultDuration: 6, durations: [6, 10] },
  "hailuo-video-2.3-fast": { modelName: "Hailuo", modelVersion: "2.3-fast", maxReferences: 1, defaultDuration: 6, durations: [6, 10] },
  "hailuo-video-H3": { modelName: "Hailuo", modelVersion: "H3", maxReferences: 9, defaultDuration: 6, durationMin: 4, durationMax: 15 },
  "hailuo-video-H3-Max": { modelName: "Hailuo", modelVersion: "H3-Max", maxReferences: 9, defaultDuration: 6, durationMin: 5, durationMax: 15 },
  "kling-video": { modelName: "Kling", maxReferences: 1, defaultDuration: 5, durations: [5, 10] },
  "kling-video-2.5": { modelName: "Kling", modelVersion: "2.5", maxReferences: 1, defaultDuration: 5, durations: [5, 10] },
  "kling-video-o1": { modelName: "Kling", modelVersion: "O1", maxReferences: 7, maxReferencesWithVideo: 4, defaultDuration: 5, durationMin: 3, durationMax: 10 },
  "kling-video-2.6": { modelName: "Kling", modelVersion: "2.6", maxReferences: 1, defaultDuration: 5, durations: [5, 10] },
  "kling-video-3.0": { modelName: "Kling", modelVersion: "3.0", maxReferences: 1, defaultDuration: 5, durationMin: 3, durationMax: 15 },
  "kling-video-3.0-omni": { modelName: "Kling", modelVersion: "3.0-Omni", maxReferences: 7, maxReferencesWithVideo: 4, defaultDuration: 5, durationMin: 3, durationMax: 15, durationMaxWithVideo: 10 },
  "kling-video-3.0-turbo": { modelName: "Kling", modelVersion: "3.0-turbo", maxReferences: 1, defaultDuration: 5, durations: [5, 10] },
  "kling-video-4.0": { modelName: "Kling", modelVersion: "4.0", maxReferences: 1, defaultDuration: 5, durationMin: 3, durationMax: 30 },
  "kling-video-4.0-omni": { modelName: "Kling", modelVersion: "4.0-Omni", maxReferences: 10, defaultDuration: 5, durationMin: 3, durationMax: 30 },
  "vidu-video": { modelName: "Vidu", maxReferences: 1, defaultDuration: 5, durationMin: 1, durationMax: 10 },
  "vidu-video-q2": { modelName: "Vidu", modelVersion: "q2", maxReferences: 7, defaultDuration: 5, durationMin: 1, durationMax: 10 },
  "vidu-video-q2-pro": { modelName: "Vidu", modelVersion: "q2-pro", maxReferences: 7, defaultDuration: 5, durationMin: 1, durationMax: 10 },
  "vidu-video-q2-turbo": { modelName: "Vidu", modelVersion: "q2-turbo", maxReferences: 1, defaultDuration: 5, durationMin: 1, durationMax: 10 },
  "vidu-video-q3-pro": { modelName: "Vidu", modelVersion: "q3-pro", maxReferences: 1, defaultDuration: 5, durationMin: 3, durationMax: 16 },
  "vidu-video-q3-turbo": { modelName: "Vidu", modelVersion: "q3-turbo", maxReferences: 7, defaultDuration: 5, durationMin: 3, durationMax: 16 },
  "vidu-video-q3": { modelName: "Vidu", modelVersion: "q3", maxReferences: 7, defaultDuration: 5, durationMin: 3, durationMax: 16 },
  "vidu-video-q3-mix": { modelName: "Vidu", modelVersion: "q3-mix", maxReferences: 7, defaultDuration: 5, durationMin: 3, durationMax: 16 },
  "vidu-video-q4-preview": { modelName: "Vidu", modelVersion: "q4-preview", maxReferences: 15, defaultDuration: 5, durationMin: 3, durationMax: 16 },
  "pixverse-video": { modelName: "PixVerse", maxReferences: 7, defaultDuration: 5 },
  "pixverse-video-v5.6": { modelName: "PixVerse", modelVersion: "v5.6", maxReferences: 7, defaultDuration: 5, durations: [5, 8, 10] },
  "pixverse-video-v6": { modelName: "PixVerse", modelVersion: "v6", maxReferences: 7, defaultDuration: 5, durationMin: 1, durationMax: 15 },
  "pixverse-video-c1": { modelName: "PixVerse", modelVersion: "c1", maxReferences: 7, defaultDuration: 5, durationMin: 1, durationMax: 15 },
  "mingmou-video": { modelName: "Mingmou", maxReferences: 1, defaultDuration: 5 },
  "h2-video": { modelName: "H2", maxReferences: 1, defaultDuration: 5, durationMin: 3, durationMax: 15 },
  "h2-video-1.0": { modelName: "H2", modelVersion: "1.0", maxReferences: 9, maxReferencesWithVideo: 5, defaultDuration: 5, durationMin: 3, durationMax: 15 },
  "h2-video-1.1": { modelName: "H2", modelVersion: "1.1", maxReferences: 1, defaultDuration: 5, durationMin: 3, durationMax: 15 },
};

const AUDIO_MODELS = {
  "gl-audio": { modelName: "GL" },
  "gl-audio-3.0-clip": { modelName: "GL", modelVersion: "3.0-clip" },
  "gl-audio-3.0-pro": { modelName: "GL", modelVersion: "3.0-pro" },
  "minimax-music": { modelName: "MiniMaxMusic" },
  "minimax-music-2.0": { modelName: "MiniMaxMusic", modelVersion: "2.0" },
  "minimax-music-2.5": { modelName: "MiniMaxMusic", modelVersion: "2.5" },
  "minimax-music-2.6": { modelName: "MiniMaxMusic", modelVersion: "2.6" },
  "minimax-music-3.0": { modelName: "MiniMaxMusic", modelVersion: "3.0" },
  "el-audio": { modelName: "EL" },
  "el-audio-compose-v2": { modelName: "EL", modelVersion: "compose_v2" },
  "el-audio-sound-t2s-v2": { modelName: "EL", modelVersion: "sound_t2s_v2" },
  "mureka-music": { modelName: "Mureka" },
  "mureka-music-song-8": { modelName: "Mureka", modelVersion: "song_8" },
  "mureka-music-song-9": { modelName: "Mureka", modelVersion: "song_9" },
  "mureka-music-song-9.5": { modelName: "Mureka", modelVersion: "song_9.5" },
  "mureka-music-instrumental-8": { modelName: "Mureka", modelVersion: "instrumental_8" },
  "mureka-music-instrumental-9": { modelName: "Mureka", modelVersion: "instrumental_9" },
  "mureka-music-instrumental-9.5": { modelName: "Mureka", modelVersion: "instrumental_9.5" },
};

// ProcessMedia uses Definition 33 and carries the actual vendor model inside
// AiAnalysisTask.ExtendedParameter. These internal model names keep its
// per-task billing separate from the generation model families.
const ANALYSIS_MODELS = {
  "wand-vega-vl-media": { modelName: "" },
  "wand-vega-vl-1.0-lite-media": { modelName: "wand-vega-vl-1.0-lite" },
  "wand-vega-vl-1.0-flash-media": { modelName: "wand-vega-vl-1.0-flash" },
  "wand-vega-vl-1.0-pro-media": { modelName: "wand-vega-vl-1.0-pro" },
};

// Scenario applications use a different task API and lifecycle from the
// general image/video/audio generation actions. Internal model names keep
// their pricing and query actions independent while the native route still
// accepts Tencent Cloud's original X-TC-Action wire format.
const SCENARIO_MODELS = {
  "wand-doc-to-video-1.0": { scenario: "doc", modelVersion: "1.0" },
  "wand-doc-to-video-1.0-lite": { scenario: "doc", modelVersion: "1.0-lite" },
  "tencentmps-doc-to-video-control": { scenario: "doc_control" },
  "tencentmps-viral-clone-flash": { scenario: "viral", modelTier: "flash" },
  "tencentmps-viral-clone-pro": { scenario: "viral", modelTier: "pro" },
  "tencentmps-viral-depth": { scenario: "viral", mode: "depth" },
  "tencentmps-video-fission": { scenario: "fission" },
  "tencentmps-video-fission-standard": { scenario: "fission", modelTier: "standard" },
  "tencentmps-video-fission-flagship": { scenario: "fission", modelTier: "flagship" },
};

const IMAGE_MODELS_LIST = Object.keys(IMAGE_MODELS);
const VIDEO_MODELS_LIST = Object.keys(VIDEO_MODELS);
const AUDIO_MODELS_LIST = Object.keys(AUDIO_MODELS);
const ANALYSIS_MODELS_LIST = Object.keys(ANALYSIS_MODELS);
const SCENARIO_MODELS_LIST = Object.keys(SCENARIO_MODELS);
const FISSION_MODELS_LIST = SCENARIO_MODELS_LIST.filter(function (model) {
  return SCENARIO_MODELS[model].scenario === "fission";
});
const SCENARIO_COUNT_MODELS_LIST = SCENARIO_MODELS_LIST.filter(function (model) {
  return SCENARIO_MODELS[model].scenario !== "fission";
});

export const meta = {
  apiVersion: 1,
  key: "tencentmps",
  name: "Tencent MPS",
  icon: "Tencent.Color",
  description: {
    en: "AIGC generation and multimodal understanding via Tencent Cloud MPS",
    zh: "通过腾讯云 MPS 进行 AIGC 生成和多模态理解",
  },
  version: "1.0.0",
  author: { name: "new-api" },
  baseUrl: "https://mps.tencentcloudapi.com",
  models: IMAGE_MODELS_LIST.concat(VIDEO_MODELS_LIST, AUDIO_MODELS_LIST, ANALYSIS_MODELS_LIST, SCENARIO_MODELS_LIST),
  fetchMode: "per_task",
  auth: { type: "api_key" },
  // MPS reports no token usage. Image and audio tasks bill the produced
  // output count; video tasks bill the produced duration in seconds. The
  // families have different facts, so each model family carries its own
  // profile and the schema below is the fallback for an unmatched model.
  usageSchema: IMAGE_USAGE_SCHEMA,
  usageExamples: IMAGE_USAGE_EXAMPLES,
  usageProfiles: [
    { models: IMAGE_MODELS_LIST, schema: IMAGE_USAGE_SCHEMA, examples: IMAGE_USAGE_EXAMPLES },
    { models: VIDEO_MODELS_LIST, schema: VIDEO_USAGE_SCHEMA, examples: VIDEO_USAGE_EXAMPLES },
    { models: AUDIO_MODELS_LIST, schema: AUDIO_USAGE_SCHEMA, examples: AUDIO_USAGE_EXAMPLES },
    { models: ANALYSIS_MODELS_LIST, schema: ANALYSIS_USAGE_SCHEMA, examples: ANALYSIS_USAGE_EXAMPLES },
    { models: SCENARIO_COUNT_MODELS_LIST, schema: SCENARIO_USAGE_SCHEMA, examples: SCENARIO_USAGE_EXAMPLES },
    { models: FISSION_MODELS_LIST, schema: VIDEO_USAGE_SCHEMA, examples: VIDEO_USAGE_EXAMPLES },
  ],
  routes: [
    // Tencent Cloud's API signs POST /. The host privately aliases that native
    // endpoint to /tencentmps; direct HTTP clients may use either address while
    // keeping the X-TC-Action request and Response envelope unchanged.
    { method: "POST", path: "/tencentmps", type: "dynamic", decode: "mpsTask", render: "mpsTaskResult" },
  ],
  protocols: [
    { name: "openai_image", models: IMAGE_MODELS_LIST },
    { name: "openai_video", models: VIDEO_MODELS_LIST },
  ],
};

const HOST = "mps.tencentcloudapi.com";
const SERVICE = "mps";
const VERSION = "2019-06-12";
const ACTION_CREATE_IMAGE = "CreateAigcImageTask";
const ACTION_DESCRIBE_IMAGE = "DescribeAigcImageTask";
const ACTION_CREATE_VIDEO = "CreateAigcVideoTask";
const ACTION_DESCRIBE_VIDEO = "DescribeAigcVideoTask";
const ACTION_CREATE_AUDIO = "CreateAigcAudioTask";
const ACTION_DESCRIBE_AUDIO = "DescribeAigcAudioTask";
const ACTION_PROCESS_MEDIA = "ProcessMedia";
const ACTION_DESCRIBE_TASK_DETAIL = "DescribeTaskDetail";
const ACTION_CREATE_DOC_VIDEO = "CreateDocToVideoTask";
const ACTION_MODIFY_DOC_VIDEO = "ModifyDocToVideoTaskStatus";
const ACTION_CREATE_FISSION = "CreateAiFissionTask";
const ACTION_DESCRIBE_SCENARIO = "DescribeAigcTaskStatus";
const ACTION_CLONE_VIRAL = "CloneViral";
const ACTION_DESCRIBE_CLONE_VIRAL = "DescribeCloneViralTask";
const CONTENT_TYPE = "application/json";


// The host count ceiling, matching relaykit/dto.MaxImageN.
const MAX_IMAGE_OUTPUTS = 128;
const MAX_AUDIO_OUTPUTS = 128;
// The host's second fact ceiling.
const MAX_VIDEO_SECONDS = 3600;

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonBody(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  if (!ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value)) {
    throw new Error("request body must be an object");
  }
  return ctx.body.value;
}

function requestHeader(ctx, name) {
  const headers = plainObject(ctx && ctx.requestHeaders);
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return trimmed(headers[key]);
  }
  return "";
}

function inputObject(value, name) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(name + " must be an object");
  }
  return value;
}

function modelSpec(model) {
  const name = trimmed(model);
  const spec = IMAGE_MODELS[name] || VIDEO_MODELS[name] || AUDIO_MODELS[name] || ANALYSIS_MODELS[name] || SCENARIO_MODELS[name];
  if (!spec) throw new Error("model is not served by the Tencent MPS plugin: " + name);
  return spec;
}

function upstreamModel(ctx) {
  return trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model);
}

function credentials(ctx) {
  const raw = trimmed(ctx.apiKey);
  const parts = raw.split("|");
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    !trimmed(parts[0]) ||
    !trimmed(parts[1]) ||
    (parts.length === 3 && !trimmed(parts[2]))
  ) {
    throw new Error(
      "invalid Tencent MPS credential: expected 'SecretId|SecretKey' or 'SecretId|SecretKey|Region'",
    );
  }
  return {
    secretId: trimmed(parts[0]),
    secretKey: trimmed(parts[1]),
    region: trimmed(parts[2]),
  };
}

// Tencent Cloud TC3-HMAC-SHA256. Host participates in the canonical request,
// but the transport derives it from the URL because plugins may not override
// transport-owned headers.
function signHeaders(ctx, action, body) {
  const creds = credentials(ctx);
  const timestamp = utils.unixNow();
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders =
    "content-type:" +
    CONTENT_TYPE +
    "\nhost:" +
    HOST +
    "\nx-tc-action:" +
    action.toLowerCase() +
    "\n";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    utils.sha256Hex(body),
  ].join("\n");
  const credentialScope = date + "/" + SERVICE + "/tc3_request";
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    utils.sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = utils.hmacSHA256(date, "TC3" + creds.secretKey);
  const secretService = utils.hmacSHA256HexKey(SERVICE, secretDate);
  const secretSigning = utils.hmacSHA256HexKey("tc3_request", secretService);
  const signature = utils.hmacSHA256HexKey(stringToSign, secretSigning);
  const headers = {
    "Content-Type": CONTENT_TYPE,
    "X-TC-Action": action,
    "X-TC-Version": VERSION,
    "X-TC-Timestamp": String(timestamp),
    Authorization:
      "TC3-HMAC-SHA256 Credential=" +
      creds.secretId +
      "/" +
      credentialScope +
      ", SignedHeaders=" +
      signedHeaders +
      ", Signature=" +
      signature,
  };
  if (creds.region) headers["X-TC-Region"] = creds.region;
  return headers;
}

// The vendor's own JSON is the request body, so the plugin sends it as a
// string and signs exactly those bytes.
function vendorRequest(ctx, action, payload) {
  const body = JSON.stringify(payload);
  return {
    url: "https://" + HOST + "/",
    method: "POST",
    headers: signHeaders(ctx, action, body),
    body: body,
  };
}

function vendorResponse(body) {
  const envelope = plainObject(body);
  if (envelope.Response === undefined || envelope.Response === null) {
    throw new Error("Tencent MPS returned an unexpected response body");
  }
  return plainObject(envelope.Response);
}

function vendorError(body) {
  const envelope = plainObject(body);
  const error = plainObject(envelope.Response && envelope.Response.Error);
  const code = trimmed(error.Code);
  const message = trimmed(error.Message);
  if (!code) return "";
  return message ? code + ": " + message : code;
}

function outputUrls(data, vendorKey, normalizedKey) {
  const root = plainObject(data);
  const response = plainObject(root.Response);
  const listed = response[vendorKey] !== undefined ? response[vendorKey] : root[normalizedKey];
  if (!Array.isArray(listed)) return [];
  const urls = [];
  for (const item of listed) {
    const url = trimmed(item);
    if (url) urls.push(url);
  }
  return urls;
}

function outputInfo(data, vendorKey, normalizedKey) {
  const root = plainObject(data);
  const response = plainObject(root.Response);
  const listed = response[vendorKey] !== undefined ? response[vendorKey] : root[normalizedKey];
  if (!Array.isArray(listed)) return [];
  const outputs = [];
  for (const item of listed) {
    const info = plainObject(item);
    const url = trimmed(info.Url || info.url);
    if (!url) continue;
    const output = { url: url };
    const duration = Number(info.Duration === undefined ? info.duration : info.Duration);
    if (Number.isFinite(duration) && duration >= 0) output.duration = duration;
    outputs.push(output);
  }
  return outputs;
}

// The gateway model name may carry the vendor ModelVersion after a colon,
// so a caller can reach a version the default map does not list.
function splitModel(model) {
  const raw = trimmed(model);
  const cut = raw.indexOf(":");
  if (cut < 0) return { name: raw, version: "" };
  return { name: raw.slice(0, cut), version: raw.slice(cut + 1) };
}

function mpsImageModel(modelName, modelVersion) {
  const name = trimmed(modelName).toLowerCase();
  const version = trimmed(modelVersion).toLowerCase();
  const models = {
    "hunyuan:": "hunyuan-image",
    "hunyuan:3.5-preview": "hunyuan-image-3.5-preview",
    "hunyuan:3.0": "hunyuan-image-3.0",
    "qwen:": "qwen-image",
    "qwen:0925": "qwen-image-0925",
    "vidu:": "vidu-image",
    "vidu:q2": "vidu-image-q2",
    "kling:": "kling-image",
    "kling:2.1": "kling-image-2.1",
    "kling:o1": "kling-image-o1",
    "kling:3.0": "kling-image-3.0",
    "kling:3.0-omni": "kling-image-3.0-omni",
    "wand-vega-image:": "wand-vega-image",
    "wand-vega-image:1.0-lite": "wand-vega-image-1.0-lite",
    "wand-vega-image:1.0-flash": "wand-vega-image-1.0-flash",
    "wand-vega-image:1.0-pro": "wand-vega-image-1.0-pro",
  };
  const model = models[name + ":" + version];
  if (!model) throw new Error("unsupported MPS image model or version");
  return model;
}

function mpsAudioModel(modelName, modelVersion) {
  const name = trimmed(modelName).toLowerCase();
  const version = trimmed(modelVersion).toLowerCase();
  const models = {
    "gl:": "gl-audio",
    "gl:3.0-clip": "gl-audio-3.0-clip",
    "gl:3.0-pro": "gl-audio-3.0-pro",
    "minimaxmusic:": "minimax-music",
    "minimaxmusic:2.0": "minimax-music-2.0",
    "minimaxmusic:2.5": "minimax-music-2.5",
    "minimaxmusic:2.6": "minimax-music-2.6",
    "minimaxmusic:3.0": "minimax-music-3.0",
    "el:": "el-audio",
    "el:compose_v2": "el-audio-compose-v2",
    "el:sound_t2s_v2": "el-audio-sound-t2s-v2",
    "mureka:": "mureka-music",
    "mureka:song_8": "mureka-music-song-8",
    "mureka:song_9": "mureka-music-song-9",
    "mureka:song_9.5": "mureka-music-song-9.5",
    "mureka:instrumental_8": "mureka-music-instrumental-8",
    "mureka:instrumental_9": "mureka-music-instrumental-9",
    "mureka:instrumental_9.5": "mureka-music-instrumental-9.5",
  };
  const model = models[name + ":" + version];
  if (!model) throw new Error("unsupported MPS audio model or version");
  return model;
}

function mpsVideoModel(modelName, modelVersion) {
  const name = trimmed(modelName).toLowerCase();
  const version = trimmed(modelVersion).toLowerCase();
  for (const model of Object.keys(VIDEO_MODELS)) {
    const spec = VIDEO_MODELS[model];
    if (spec.modelName.toLowerCase() !== name) continue;
    if (trimmed(spec.modelVersion).toLowerCase() === version) return model;
  }
  throw new Error("unsupported MPS video model or version");
}

function mpsAnalysisModel(modelName) {
  const name = trimmed(modelName).toLowerCase();
  if (!name) return "wand-vega-vl-media";
  for (const model of Object.keys(ANALYSIS_MODELS)) {
    if (ANALYSIS_MODELS[model].modelName.toLowerCase() === name) return model;
  }
  throw new Error("unsupported MPS multimodal understanding model");
}

function analysisExtendedParameter(body) {
  const task = inputObject(body.AiAnalysisTask, "AiAnalysisTask");
  if (Number(task.Definition) !== 33) throw new Error("AiAnalysisTask.Definition must be 33");
  const raw = trimmed(task.ExtendedParameter);
  if (!raw) throw new Error("AiAnalysisTask.ExtendedParameter is required");
  let extended;
  try {
    extended = inputObject(JSON.parse(raw), "AiAnalysisTask.ExtendedParameter");
  } catch (error) {
    if (String(error && error.message).includes("must be an object")) throw error;
    throw new Error("AiAnalysisTask.ExtendedParameter must be a JSON object string");
  }
  const mvc = inputObject(extended.mvc, "AiAnalysisTask.ExtendedParameter.mvc");
  if (!trimmed(mvc.prompt)) throw new Error("AiAnalysisTask.ExtendedParameter.mvc.prompt is required");
  const mode = trimmed(mvc.mode);
  if (mode && mode !== "audio") throw new Error("AiAnalysisTask.ExtendedParameter.mvc.mode must be audio");
  if (mvc.extendData !== undefined && !Array.isArray(mvc.extendData)) {
    throw new Error("AiAnalysisTask.ExtendedParameter.mvc.extendData must be an array");
  }
  for (const item of Array.isArray(mvc.extendData) ? mvc.extendData : []) {
    const url = trimmed(plainObject(item).url);
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("AiAnalysisTask.ExtendedParameter.mvc.extendData[].url must be an absolute http(s) URL");
    }
  }
  return mvc;
}

function mpsNativeAnalysisRequest(body) {
  const input = inputObject(body.InputInfo, "InputInfo");
  const type = trimmed(input.Type).toUpperCase();
  if (type !== "URL" && type !== "COS") throw new Error("InputInfo.Type must be URL or COS");
  if (type === "URL") {
    const url = trimmed(plainObject(input.UrlInputInfo).Url);
    if (!/^https?:\/\//i.test(url)) throw new Error("InputInfo.UrlInputInfo.Url must be an absolute http(s) URL");
    if (!Object.keys(plainObject(body.OutputStorage)).length) {
      throw new Error("OutputStorage is required when InputInfo.Type is URL");
    }
  } else {
    const cos = plainObject(input.CosInputInfo);
    if (!trimmed(cos.Bucket) || !trimmed(cos.Region) || !trimmed(cos.Object)) {
      throw new Error("InputInfo.CosInputInfo Bucket, Region, and Object are required");
    }
  }
  analysisExtendedParameter(body);
  const vendorBody = {};
  for (const key of Object.keys(body)) {
    if (key !== "Action" && key !== "Version" && key !== "Region") vendorBody[key] = body[key];
  }
  return { vendor_body: vendorBody };
}

function scenarioVendorBody(body) {
  const vendorBody = {};
  for (const key of Object.keys(body)) {
    if (key !== "Action" && key !== "Version" && key !== "Region") vendorBody[key] = body[key];
  }
  return vendorBody;
}

function requireHTTPURL(value, name) {
  const url = trimmed(value);
  if (!/^https?:\/\//i.test(url)) throw new Error(name + " must be an absolute http(s) URL");
  return url;
}

function requireURLArray(value, name, minimum, maximum) {
  if (!Array.isArray(value)) throw new Error(name + " must be an array");
  if (value.length < minimum || value.length > maximum) {
    throw new Error(name + " must contain between " + minimum + " and " + maximum + " URLs");
  }
  for (const item of value) requireHTTPURL(item, name + "[]");
  return value;
}

function optionalEnum(value, name, allowed) {
  const text = trimmed(value);
  if (text && allowed.indexOf(text) < 0) throw new Error(name + " must be one of " + allowed.join(", "));
  return text;
}

function optionalBoolean(value, name) {
  if (value !== undefined && value !== null && typeof value !== "boolean") {
    throw new Error(name + " must be a boolean");
  }
}

function mpsNativeDocVideoRequest(body) {
  const input = inputObject(body.Input, "Input");
  const files = requireURLArray(input.FileUrl, "Input.FileUrl", 1, 3);
  const prompt = trimmed(input.Prompt);
  if (!prompt) throw new Error("Input.Prompt is required");
  if (prompt.length > 2000) throw new Error("Input.Prompt must not exceed 2000 characters");
  const modelName = trimmed(input.ModelName) || "WAND";
  if (modelName.toUpperCase() !== "WAND") throw new Error("Input.ModelName must be WAND");
  const modelVersion = trimmed(input.ModelVersion) || "1.0";
  optionalEnum(modelVersion, "Input.ModelVersion", ["1.0", "1.0-lite"]);
  optionalEnum(input.Mode, "Input.Mode", ["auto", "stage"]);
  optionalEnum(input.Ratio, "Input.Ratio", ["16:9", "9:16", "1:1"]);
  optionalEnum(input.Language, "Input.Language", ["zh", "en", "ja", "ko", "ru", "fr", "es", "de"]);
  if (input.ReferenceDuration !== undefined && input.ReferenceDuration !== null) {
    const duration = Number(input.ReferenceDuration);
    if (!Number.isInteger(duration) || duration < 15 || duration > 1200) {
      throw new Error("Input.ReferenceDuration must be an integer between 15 and 1200");
    }
  }
  optionalBoolean(input.EnableTTS, "Input.EnableTTS");
  optionalBoolean(input.PPTXFidelity, "Input.PPTXFidelity");
  optionalBoolean(input.EnableCaption, "Input.EnableCaption");
  if (input.PPTXFidelity === true && !files.some(function (url) { return /\.pptx(?:$|[?#])/i.test(url); })) {
    throw new Error("Input.FileUrl must contain a PPTX document when Input.PPTXFidelity is true");
  }
  const backgroundURL = trimmed(plainObject(input.Background).ImageUrl);
  if (backgroundURL) requireHTTPURL(backgroundURL, "Input.Background.ImageUrl");
  const watermark = plainObject(input.Watermark);
  const watermarkURL = trimmed(watermark.ImageUrl);
  if (watermarkURL) requireHTTPURL(watermarkURL, "Input.Watermark.ImageUrl");
  optionalEnum(watermark.Position, "Input.Watermark.Position", ["top-left", "top-right", "bottom-left", "bottom-right"]);
  return {
    model: modelVersion === "1.0-lite" ? "wand-doc-to-video-1.0-lite" : "wand-doc-to-video-1.0",
    requestBody: { scenario_action: ACTION_CREATE_DOC_VIDEO, vendor_body: scenarioVendorBody(body) },
  };
}

function mpsNativeDocVideoControlRequest(body) {
  const input = inputObject(body.Input, "Input");
  const action = optionalEnum(input.Action, "Input.Action", ["confirm", "regenerate"]);
  if (!action) throw new Error("Input.Action is required");
  if (!optionalEnum(input.Stage, "Input.Stage", ["STAGE_1", "STAGE_2"])) throw new Error("Input.Stage is required");
  const sourceTaskID = trimmed(input.SourceTaskId);
  if (!sourceTaskID) throw new Error("Input.SourceTaskId is required");
  if (action === "regenerate") {
    const regenerate = inputObject(input.Regenerate, "Input.Regenerate");
    const scope = optionalEnum(regenerate.Scope, "Input.Regenerate.Scope", ["full", "scenes"]);
    if (!scope) throw new Error("Input.Regenerate.Scope is required");
    if (!trimmed(regenerate.Prompt)) throw new Error("Input.Regenerate.Prompt is required");
    if (scope === "scenes") {
      if (!Array.isArray(regenerate.SceneIds) || regenerate.SceneIds.length < 1 || regenerate.SceneIds.length > 5) {
        throw new Error("Input.Regenerate.SceneIds must contain between 1 and 5 scene IDs");
      }
      const seen = {};
      for (const sceneID of regenerate.SceneIds) {
        const id = trimmed(sceneID);
        if (!id || seen[id]) throw new Error("Input.Regenerate.SceneIds must contain unique non-empty scene IDs");
        seen[id] = true;
      }
    }
  } else if (input.Regenerate !== undefined && input.Regenerate !== null) {
    throw new Error("Input.Regenerate is supported only when Input.Action is regenerate");
  }
  return {
    model: "tencentmps-doc-to-video-control",
    sourceTaskID: sourceTaskID,
    requestBody: { scenario_action: ACTION_MODIFY_DOC_VIDEO, vendor_body: scenarioVendorBody(body) },
  };
}

function mpsNativeFissionRequest(body) {
  const input = inputObject(body.Input, "Input");
  requireURLArray(input.ImageUrls, "Input.ImageUrls", 1, 9);
  const task = inputObject(body.TaskInfo, "TaskInfo");
  const duration = task.Duration === undefined || task.Duration === null ? 15 : Number(task.Duration);
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw new Error("TaskInfo.Duration must be an integer between 4 and 15");
  }
  const tier = optionalEnum(task.ModelTier, "TaskInfo.ModelTier", ["standard", "flagship"]);
  optionalEnum(task.Ratio, "TaskInfo.Ratio", ["9:16", "16:9", "1:1", "3:4", "4:3"]);
  optionalEnum(task.Resolution, "TaskInfo.Resolution", ["720p", "1080p", "2k", "4k"]);
  optionalEnum(task.VideoType, "TaskInfo.VideoType", ["ugc", "talk", "display", "unboxing", "reaction"]);
  optionalEnum(task.Language, "TaskInfo.Language", ["english", "chinese", "japanese", "korean", "spanish", "portuguese", "music_only"]);
  optionalEnum(task.Market, "TaskInfo.Market", ["north_america", "europe", "china", "japan", "korea", "southeast_asia", "brazil", "global", "other"]);
  if (task.SplitCount !== undefined && task.SplitCount !== null) {
    const count = Number(task.SplitCount);
    if (!Number.isInteger(count) || count < 0 || count > 1) throw new Error("TaskInfo.SplitCount must be 0 or 1");
  }
  const model = tier ? "tencentmps-video-fission-" + tier : "tencentmps-video-fission";
  return {
    model: model,
    requestBody: { scenario_action: ACTION_CREATE_FISSION, vendor_body: scenarioVendorBody(body), seconds: duration },
  };
}

function mpsNativeViralRequest(body) {
  requireHTTPURL(body.VideoUrl, "VideoUrl");
  const mode = optionalEnum(body.Mode, "Mode", ["script", "motion", "depth"]) || "script";
  const aigc = inputObject(body.AIGCParam, "AIGCParam");
  const tier = optionalEnum(aigc.ModelTier, "AIGCParam.ModelTier", ["flash", "pro"]) || "flash";
  if (aigc.Duration !== undefined && aigc.Duration !== null) {
    const duration = Number(aigc.Duration);
    const minimum = tier === "pro" ? 4 : 2;
    const maximum = tier === "pro" ? 30 : 15;
    if (!Number.isInteger(duration) || duration < minimum || duration > maximum) {
      throw new Error("AIGCParam.Duration must be an integer between " + minimum + " and " + maximum + " for this model tier");
    }
    if (mode !== "script") throw new Error("AIGCParam.Duration is supported only when Mode is script");
  }
  const ratio = optionalEnum(aigc.AspectRatio, "AIGCParam.AspectRatio", ["9:16", "16:9", "3:4", "4:3", "1:1", "21:9", "adaptive"]);
  if (ratio === "adaptive" && tier === "flash") throw new Error("AIGCParam.AspectRatio adaptive is not supported by the flash tier");
  optionalEnum(aigc.Resolution, "AIGCParam.Resolution", ["720p", "1080p"]);
  optionalBoolean(aigc.DepthWithAudio, "AIGCParam.DepthWithAudio");

  const product = plainObject(body.Product);
  const productImages = product.Images === undefined ? [] : requireURLArray(product.Images, "Product.Images", mode === "script" ? 1 : 0, 9);
  const personaImages = plainObject(body.Persona).Images === undefined
    ? []
    : requireURLArray(plainObject(body.Persona).Images, "Persona.Images", 0, 9);
  const reference = plainObject(body.Reference);
  const outfits = reference.Outfits === undefined ? [] : requireURLArray(reference.Outfits, "Reference.Outfits", 0, 9);
  const backgrounds = reference.Backgrounds === undefined ? [] : requireURLArray(reference.Backgrounds, "Reference.Backgrounds", 0, 9);
  if (mode === "script" && productImages.length === 0) throw new Error("Product.Images is required when Mode is script");
  if (mode !== "motion" && (outfits.length || backgrounds.length)) {
    throw new Error("Reference is supported only when Mode is motion");
  }
  if (productImages.length + personaImages.length + outfits.length + backgrounds.length > 9) {
    throw new Error("at most 9 reference images are supported");
  }
  const output = plainObject(body.Output);
  const outputType = optionalEnum(output.Type, "Output.Type", ["url", "cos"]);
  if (outputType === "cos") {
    const cos = inputObject(output.CosInfo, "Output.CosInfo");
    if (!trimmed(cos.Region) || !trimmed(cos.Bucket)) {
      throw new Error("Output.CosInfo.Region and Output.CosInfo.Bucket are required when Output.Type is cos");
    }
  }
  return {
    model: mode === "depth" ? "tencentmps-viral-depth" : "tencentmps-viral-clone-" + tier,
    requestBody: { scenario_action: ACTION_CLONE_VIRAL, vendor_body: scenarioVendorBody(body), scenario_mode: mode },
  };
}

function mpsNativeImageRequest(body) {
  const extra = plainObject(body.ExtraParameters);
  const cos = plainObject(body.StoreCosParam);
  const request = {
    prompt: body.Prompt,
    negative_prompt: body.NegativePrompt,
    enhance_prompt: body.EnhancePrompt,
    scene_type: body.SceneType,
    n: body.OutputImageCount,
    additional_parameters: body.AdditionalParameters,
    operator: body.Operator,
  };
  if (Array.isArray(body.ImageInfos)) {
    request.images = body.ImageInfos.map(function (item) {
      const image = plainObject(item);
      return { url: image.ImageUrl || image.Url, reference_type: image.ReferenceType };
    });
  }
  if (Object.keys(extra).length) {
    request.extra_parameters = {
      aspect_ratio: extra.AspectRatio,
      resolution: extra.Resolution,
      output_format: extra.OutputFormat,
      logo_add: extra.LogoAdd,
    };
  }
  if (Object.keys(cos).length) {
    request.store_cos_param = {
      bucket_name: cos.CosBucketName,
      bucket_region: cos.CosBucketRegion,
      bucket_path: cos.CosBucketPath,
    };
  }
  return request;
}

function mpsNativeVideoRequest(body) {
  const extra = plainObject(body.ExtraParameters);
  const cos = plainObject(body.StoreCosParam);
  const request = {
    prompt: body.Prompt,
    negative_prompt: body.NegativePrompt,
    enhance_prompt: body.EnhancePrompt,
    scene_type: body.SceneType,
    image: body.ImageUrl,
    last_image: body.LastImageUrl,
    duration: body.Duration,
    additional_parameters: body.AdditionalParameters,
    operator: body.Operator,
  };
  if (Array.isArray(body.ImageInfos)) {
    request.images = body.ImageInfos.map(function (item) {
      const image = plainObject(item);
      return {
        url: image.ImageUrl,
        reference_type: image.ReferenceType,
        text: image.Text,
      };
    });
  }
  if (Array.isArray(body.VideoInfos)) {
    request.video_infos = body.VideoInfos.map(function (item) {
      const video = plainObject(item);
      return {
        url: video.VideoUrl,
        refer_type: video.ReferType,
        keep_original_sound: video.KeepOriginalSound,
      };
    });
  }
  if (Array.isArray(body.AudioInfos)) {
    request.audio_infos = body.AudioInfos.map(function (item) {
      return { url: plainObject(item).AudioUrl };
    });
  }
  if (Array.isArray(body.SubjectInfos)) {
    request.subject_infos = body.SubjectInfos.map(function (item) {
      const subject = plainObject(item);
      return {
        id: subject.Id,
        name: subject.Name,
        voice_id: subject.VoiceId,
        image_urls: subject.ImageUrls,
        video_urls: subject.VideoUrls,
      };
    });
  }
  if (Object.keys(extra).length) {
    request.extra_parameters = {
      resolution: extra.Resolution,
      aspect_ratio: extra.AspectRatio,
      logo_add: extra.LogoAdd,
      enable_audio: extra.EnableAudio,
      off_peak: extra.OffPeak,
      enable_bgm: extra.EnableBgm,
    };
  }
  if (Object.keys(cos).length) {
    request.store_cos_param = {
      bucket_name: cos.CosBucketName,
      bucket_region: cos.CosBucketRegion,
      bucket_path: cos.CosBucketPath,
    };
  }
  return request;
}

function mpsNativeAudioRequest(body) {
  const extra = plainObject(body.ExtraParameters);
  const cos = plainObject(body.StoreCosParam);
  const request = {
    prompt: body.Prompt,
    scene_type: body.SceneType,
    output_audio_format: body.OutputAudioFormat,
    additional_parameters: body.AdditionalParameters,
    operator: body.Operator,
  };
  if (Array.isArray(body.VideoInfos)) {
    request.video_infos = body.VideoInfos.map(function (item) {
      const info = plainObject(item);
      return { url: info.VideoUrl || info.Url };
    });
  }
  if (Array.isArray(body.AudioInfos)) {
    request.audio_infos = body.AudioInfos.map(function (item) {
      const info = plainObject(item);
      return { url: info.AudioUrl || info.Url };
    });
  }
  if (Object.keys(extra).length) {
    request.extra_parameters = {
      resource_id: extra.ResourceId,
      output_audio_format: extra.OutputAudioFormat,
    };
  }
  if (Object.keys(cos).length) {
    request.store_cos_param = {
      bucket_name: cos.CosBucketName,
      bucket_region: cos.CosBucketRegion,
      bucket_path: cos.CosBucketPath,
    };
  }
  return request;
}

function storedMPSResponse(task) {
  return plainObject(plainObject(task && task.data).Response);
}

function taskRequestID(task) {
  return trimmed(storedMPSResponse(task).RequestId);
}

function mpsTaskStatus(task) {
  const status = trimmed(task && task.status).toUpperCase();
  if (status === "SUCCESS") return "DONE";
  if (status === "FAILURE") return "FAIL";
  if (status === "IN_PROGRESS") return "RUN";
  return "WAIT";
}

function mpsScenarioTaskStatus(task) {
  const status = trimmed(task && task.status).toUpperCase();
  if (status === "SUCCESS") return "FINISHED";
  if (status === "FAILURE") return "FAILED";
  if (status === "IN_PROGRESS") return "RUNNING";
  return "PENDING";
}

function taskModelName(task) {
  const properties = plainObject(task && task.properties);
  return trimmed(properties.origin_model_name || properties.upstream_model_name || task && task.model);
}

// StoreCosParam keeps the produced files in the operator's own bucket.
// Without it the vendor keeps them for twelve hours only, so a file would
// expire before a client fetches it.
function storeCosParam(req) {
  const cos = inputObject(req.store_cos_param, "store_cos_param");
  const bucket = trimmed(cos.bucket_name);
  if (!bucket) return null;
  const region = trimmed(cos.bucket_region);
  if (!region) throw new Error("store_cos_param.bucket_region is required with bucket_name");
  const value = { CosBucketName: bucket, CosBucketRegion: region };
  const path = trimmed(cos.bucket_path);
  if (path) value.CosBucketPath = path;
  return value;
}

function referenceImages(req, maximum) {
  const references = [];
  const images = []
    .concat(req.image === undefined ? [] : req.image)
    .concat(req.images === undefined ? [] : req.images);
  for (const item of images) {
    const object = item && typeof item === "object" && !Array.isArray(item) ? item : null;
    const url = trimmed(object ? object.url || object.image_url || object.ImageUrl : item);
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("reference images must be absolute http(s) URLs the vendor can fetch");
    }
    const reference = { ImageUrl: url };
    if (object) {
      const referenceType = trimmed(object.reference_type || object.ReferenceType);
      if (referenceType) reference.ReferenceType = referenceType;
    }
    references.push(reference);
  }
  if (references.length > maximum) {
    throw new Error("at most " + maximum + " reference images are supported by this model");
  }
  return references;
}

function imagePayload(req, model) {
  const spec = modelSpec(model);
  const payload = { ModelName: spec.modelName };
  if (spec.modelVersion) payload.ModelVersion = spec.modelVersion;

  const prompt = trimmed(req.prompt);
  const negative = trimmed(req.negative_prompt);
  if (prompt.length > 1000) throw new Error("prompt must not exceed 1000 characters");
  if (prompt) payload.Prompt = prompt;
  if (negative) payload.NegativePrompt = negative;
  if (req.enhance_prompt !== undefined && req.enhance_prompt !== null && typeof req.enhance_prompt !== "boolean") {
    throw new Error("enhance_prompt must be a boolean");
  }
  if (req.enhance_prompt === true) payload.EnhancePrompt = true;
  if (req.enhance_prompt === false) payload.EnhancePrompt = false;

  const scene = trimmed(req.scene_type);
  if (scene) {
    if (scene !== "3d_panorama") throw new Error("scene_type must be 3d_panorama");
    if (spec.modelName !== "Hunyuan") throw new Error("scene_type is supported only by Hunyuan");
    payload.SceneType = scene;
  }

  const references = referenceImages(req, spec.maxReferences || 1);
  if (references.length) payload.ImageInfos = references;
  if (!prompt && !references.length) throw new Error("prompt is required when no reference image is provided");

  const count = req.n === undefined || req.n === null ? 1 : Number(req.n);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_OUTPUTS) {
    throw new Error("n must be an integer between 1 and " + MAX_IMAGE_OUTPUTS);
  }
  payload.OutputImageCount = count;

  // ExtraParameters carries the per-vendor knobs the OpenAI Images body has
  // no field for. The caller passes them as a JSON object.
  const extra = inputObject(req.extra_parameters, "extra_parameters");
  const extraParameters = {};
  const aspectRatio = trimmed(extra.aspect_ratio);
  if (aspectRatio) extraParameters.AspectRatio = aspectRatio;
  const resolution = trimmed(extra.resolution);
  if (resolution) extraParameters.Resolution = resolution;
  const outputFormat = trimmed(extra.output_format);
  if (outputFormat) {
    if (outputFormat !== "jpeg" && outputFormat !== "png") {
      throw new Error("extra_parameters.output_format must be jpeg or png");
    }
    extraParameters.OutputFormat = outputFormat;
  }
  if (extra.logo_add !== undefined && extra.logo_add !== null) {
    const logoAdd = Number(extra.logo_add);
    if (!Number.isInteger(logoAdd) || logoAdd < 0 || logoAdd > 1) {
      throw new Error("extra_parameters.logo_add must be 0 or 1");
    }
    extraParameters.LogoAdd = logoAdd;
  }
  if (Object.keys(extraParameters).length) payload.ExtraParameters = extraParameters;

  let additional = req.additional_parameters;
  if ((additional === undefined || additional === null) && trimmed(req.size)) {
    additional = { size: trimmed(req.size) };
  }
  if (additional !== undefined && additional !== null) {
    if (typeof additional === "string") {
      const value = additional.trim();
      try {
        inputObject(JSON.parse(value), "additional_parameters");
      } catch (error) {
        if (String(error && error.message).includes("must be an object")) throw error;
        throw new Error("additional_parameters must be a JSON object string");
      }
      payload.AdditionalParameters = value;
    } else {
      payload.AdditionalParameters = JSON.stringify(inputObject(additional, "additional_parameters"));
    }
  }

  // Pin the gateway's default so reservation and upstream resolution agree.
  // A custom size is handled separately and must not inherit a conflicting
  // resolution preset.
  const size = trimmed(payload.AdditionalParameters ? JSON.parse(payload.AdditionalParameters).size : "");
  let outputResolution = trimmed(extraParameters.Resolution).toUpperCase();
  if (outputResolution && !["720P", "1080P", "2K", "4K"].includes(outputResolution)) {
    throw new Error("extra_parameters.resolution must be 720P, 1080P, 2K or 4K");
  }
  if (size) {
    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) throw new Error("size must use WIDTHxHEIGHT format");
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
      throw new Error("image dimensions must be between 1 and 4096");
    }
    if (outputResolution) throw new Error("size and extra_parameters.resolution cannot be combined");
  } else {
    outputResolution = outputResolution || "1080P";
    extraParameters.Resolution = outputResolution;
    payload.ExtraParameters = extraParameters;
  }

  const cos = storeCosParam(req);
  if (cos) payload.StoreCosParam = cos;

  const operator = trimmed(req.operator);
  if (operator) payload.Operator = operator;

  return payload;
}

function videoDuration(req, spec, useDefault) {
  const stated = req.seconds === undefined || req.seconds === null ? req.duration : req.seconds;
  if (stated === undefined || stated === null) return useDefault ? spec.defaultDuration || 5 : null;
  const value = Number(stated);
  if (!Number.isInteger(value) || value < 1 || value > MAX_VIDEO_SECONDS) {
    throw new Error("seconds must be an integer between 1 and " + MAX_VIDEO_SECONDS);
  }
  if (Array.isArray(spec.durations) && spec.durations.indexOf(value) < 0) {
    throw new Error("seconds must be one of " + spec.durations.join(", ") + " for this model");
  }
  const hasVideo = Array.isArray(req.video_infos) && req.video_infos.length > 0;
  const maximum = hasVideo && spec.durationMaxWithVideo !== undefined
    ? spec.durationMaxWithVideo
    : spec.durationMax;
  if ((spec.durationMin !== undefined && value < spec.durationMin) || (maximum !== undefined && value > maximum)) {
    throw new Error("seconds is outside the supported range for this model");
  }
  return value;
}

function videoPayload(req, model) {
  const spec = modelSpec(model);
  const payload = { ModelName: spec.modelName };
  if (spec.modelVersion) payload.ModelVersion = spec.modelVersion;

  const prompt = trimmed(req.prompt);
  const negative = trimmed(req.negative_prompt);
  if (prompt.length > 2000) throw new Error("prompt must not exceed 2000 characters");
  if (prompt) payload.Prompt = prompt;
  if (negative) payload.NegativePrompt = negative;
  if (req.enhance_prompt !== undefined && req.enhance_prompt !== null && typeof req.enhance_prompt !== "boolean") {
    throw new Error("enhance_prompt must be a boolean");
  }
  if (req.enhance_prompt === true) payload.EnhancePrompt = true;
  if (req.enhance_prompt === false) payload.EnhancePrompt = false;

  const scene = trimmed(req.scene_type);
  if (scene) {
    const scenes = {
      Kling: ["motion_control", "avatar_i2v", "lip_sync"],
      Mingmou: ["land2port"],
      Vidu: ["template_effect"],
      Hunyuan: ["3d_scene"],
    };
    const supported = scenes[spec.modelName] || [];
    if (supported.indexOf(scene) < 0) {
      throw new Error("scene_type is not supported by this model");
    }
    payload.SceneType = scene;
  }

  // The first frame and the last frame are separate vendor fields.
  const first = trimmed(req.image);
  const last = trimmed(req.last_image);
  if (first) {
    if (!/^https?:\/\//i.test(first)) throw new Error("image must be an absolute http(s) URL");
    payload.ImageUrl = first;
  }
  if (last) {
    if (!/^https?:\/\//i.test(last)) throw new Error("last_image must be an absolute http(s) URL");
    payload.LastImageUrl = last;
  }

  const videoInfos = [];
  for (const item of Array.isArray(req.video_infos) ? req.video_infos : []) {
    const info = plainObject(item);
    const url = trimmed(info.url || info.video_url || info.VideoUrl);
    if (!url) throw new Error("video_infos[].url is required");
    if (!/^https?:\/\//i.test(url)) throw new Error("video_infos[].url must be an absolute http(s) URL");
    const output = { VideoUrl: url };
    const referType = trimmed(info.refer_type || info.ReferType);
    if (referType) {
      if (referType !== "feature" && referType !== "base") {
        throw new Error("video_infos[].refer_type must be feature or base");
      }
      output.ReferType = referType;
    }
    const keepSound = trimmed(info.keep_original_sound || info.KeepOriginalSound);
    if (keepSound) {
      if (keepSound !== "yes" && keepSound !== "no") {
        throw new Error("video_infos[].keep_original_sound must be yes or no");
      }
      output.KeepOriginalSound = keepSound;
    }
    videoInfos.push(output);
  }
  if (videoInfos.length) payload.VideoInfos = videoInfos;

  const maximumReferences = videoInfos.length && spec.maxReferencesWithVideo !== undefined
    ? spec.maxReferencesWithVideo
    : spec.maxReferences || 1;
  const references = [];
  for (const item of Array.isArray(req.images) ? req.images : req.images === undefined ? [] : [req.images]) {
    const object = item && typeof item === "object" && !Array.isArray(item) ? item : null;
    const url = trimmed(object ? object.url || object.image_url || object.ImageUrl : item);
    if (!url) throw new Error("images[].url is required");
    if (!/^https?:\/\//i.test(url)) throw new Error("images[].url must be an absolute http(s) URL");
    const reference = { ImageUrl: url };
    if (object) {
      const referenceType = trimmed(object.reference_type || object.ReferenceType);
      if (referenceType) reference.ReferenceType = referenceType;
      const text = trimmed(object.text || object.Text);
      if (text) reference.Text = text;
    }
    references.push(reference);
  }
  if (references.length > maximumReferences) {
    throw new Error("at most " + maximumReferences + " reference images are supported by this model");
  }
  if (references.length) payload.ImageInfos = references;
  if (!prompt && !first && !references.length) {
    throw new Error("prompt is required when no input image is provided");
  }

  const audioInfos = [];
  for (const item of Array.isArray(req.audio_infos) ? req.audio_infos : []) {
    const info = plainObject(item);
    const url = trimmed(info.url || info.audio_url || info.AudioUrl);
    if (!url) throw new Error("audio_infos[].url is required");
    if (!/^https?:\/\//i.test(url)) throw new Error("audio_infos[].url must be an absolute http(s) URL");
    audioInfos.push({ AudioUrl: url });
  }
  if (audioInfos.length) payload.AudioInfos = audioInfos;

  const subjectInfos = [];
  for (const item of Array.isArray(req.subject_infos) ? req.subject_infos : []) {
    const info = plainObject(item);
    const subject = {};
    const id = trimmed(info.id || info.Id);
    const name = trimmed(info.name || info.Name);
    const voiceID = trimmed(info.voice_id || info.VoiceId);
    if (id) subject.Id = id;
    if (name) subject.Name = name;
    if (voiceID) subject.VoiceId = voiceID;
    for (const field of [
      { input: info.image_urls || info.ImageUrls, output: "ImageUrls" },
      { input: info.video_urls || info.VideoUrls, output: "VideoUrls" },
    ]) {
      if (field.input === undefined || field.input === null) continue;
      if (!Array.isArray(field.input)) throw new Error("subject media URLs must be arrays");
      const urls = [];
      for (const value of field.input) {
        const url = trimmed(value);
        if (!/^https?:\/\//i.test(url)) throw new Error("subject media URLs must be absolute http(s) URLs");
        urls.push(url);
      }
      if (urls.length) subject[field.output] = urls;
    }
    if (!Object.keys(subject).length) throw new Error("subject_infos[] must contain subject information");
    subjectInfos.push(subject);
  }
  if (subjectInfos.length) payload.SubjectInfos = subjectInfos;

  const seconds = videoDuration(req, spec, false);
  if (seconds !== null) payload.Duration = seconds;

  // ExtraParameters carries the per-vendor knobs the video body has no
  // field for.
  const extra = plainObject(req.extra_parameters);
  const extraParameters = {};
  const resolution = trimmed(extra.resolution);
  if (resolution) extraParameters.Resolution = resolution;
  const aspectRatio = trimmed(extra.aspect_ratio);
  if (aspectRatio) extraParameters.AspectRatio = aspectRatio;
  if (extra.logo_add !== undefined && extra.logo_add !== null) {
    const logoAdd = Number(extra.logo_add);
    if (!Number.isInteger(logoAdd) || logoAdd < 0 || logoAdd > 1) {
      throw new Error("extra_parameters.logo_add must be 0 or 1");
    }
    extraParameters.LogoAdd = logoAdd;
  }
  for (const option of [
    { input: "enable_audio", output: "EnableAudio" },
    { input: "enable_bgm", output: "EnableBgm" },
    { input: "off_peak", output: "OffPeak" },
  ]) {
    const value = extra[option.input];
    if (value === undefined || value === null) continue;
    if (typeof value !== "boolean") throw new Error("extra_parameters." + option.input + " must be a boolean");
    extraParameters[option.output] = value;
  }
  if (Object.keys(extraParameters).length) payload.ExtraParameters = extraParameters;

  const additional = req.additional_parameters;
  if (additional !== undefined && additional !== null) {
    if (typeof additional === "string") {
      const value = additional.trim();
      try {
        inputObject(JSON.parse(value), "additional_parameters");
      } catch (error) {
        if (String(error && error.message).includes("must be an object")) throw error;
        throw new Error("additional_parameters must be a JSON object string");
      }
      payload.AdditionalParameters = value;
    } else {
      payload.AdditionalParameters = JSON.stringify(inputObject(additional, "additional_parameters"));
    }
  }

  const cos = storeCosParam(req);
  if (cos) payload.StoreCosParam = cos;

  const operator = trimmed(req.operator);
  if (operator) payload.Operator = operator;

  return payload;
}

function audioPayload(req, model) {
  const spec = modelSpec(model);
  const payload = { ModelName: spec.modelName };
  if (spec.modelVersion) payload.ModelVersion = spec.modelVersion;

  const prompt = trimmed(req.prompt);
  if (prompt.length > 2000) throw new Error("prompt must not exceed 2000 characters");
  if (prompt) payload.Prompt = prompt;

  const scene = trimmed(req.scene_type);
  if (scene) {
    if (scene !== "music") throw new Error("scene_type must be music");
    payload.SceneType = scene;
  }

  const videos = [];
  for (const item of Array.isArray(req.video_infos) ? req.video_infos : []) {
    const info = plainObject(item);
    const url = trimmed(info.url || info.video_url || info.VideoUrl);
    if (!url) throw new Error("video_infos[].url is required");
    if (!/^https?:\/\//i.test(url)) throw new Error("video_infos[].url must be an absolute http(s) URL");
    videos.push({ VideoUrl: url });
  }
  if (videos.length) payload.VideoInfos = videos;

  const audios = [];
  for (const item of Array.isArray(req.audio_infos) ? req.audio_infos : []) {
    const info = plainObject(item);
    const url = trimmed(info.url || info.audio_url || info.AudioUrl);
    if (!url) throw new Error("audio_infos[].url is required");
    if (!/^https?:\/\//i.test(url)) throw new Error("audio_infos[].url must be an absolute http(s) URL");
    audios.push({ AudioUrl: url });
  }
  if (audios.length) payload.AudioInfos = audios;

  const outputFormat = trimmed(req.output_audio_format);
  if (outputFormat) {
    if (outputFormat !== "mp3" && outputFormat !== "wav") {
      throw new Error("output_audio_format must be mp3 or wav");
    }
    payload.OutputAudioFormat = outputFormat;
  }

  const extra = inputObject(req.extra_parameters, "extra_parameters");
  const extraParameters = {};
  const resourceID = trimmed(extra.resource_id || extra.ResourceId);
  if (resourceID) extraParameters.ResourceId = resourceID;
  const extraOutputFormat = trimmed(extra.output_audio_format || extra.OutputAudioFormat);
  if (extraOutputFormat) {
    if (extraOutputFormat !== "mp3" && extraOutputFormat !== "wav") {
      throw new Error("extra_parameters.output_audio_format must be mp3 or wav");
    }
    extraParameters.OutputAudioFormat = extraOutputFormat;
  }
  if (Object.keys(extraParameters).length) payload.ExtraParameters = extraParameters;

  const additional = req.additional_parameters;
  if (additional !== undefined && additional !== null) {
    let parsed;
    let serialized;
    if (typeof additional === "string") {
      serialized = additional.trim();
      try {
        parsed = inputObject(JSON.parse(serialized), "additional_parameters");
      } catch (error) {
        if (String(error && error.message).includes("must be an object")) throw error;
        throw new Error("additional_parameters must be a JSON object string");
      }
    } else {
      parsed = inputObject(additional, "additional_parameters");
      serialized = JSON.stringify(parsed);
    }
    if (parsed.n !== undefined && parsed.n !== null) {
      const count = Number(parsed.n);
      if (!Number.isInteger(count) || count < 1 || count > MAX_AUDIO_OUTPUTS) {
        throw new Error("additional_parameters.n must be an integer between 1 and " + MAX_AUDIO_OUTPUTS);
      }
    }
    payload.AdditionalParameters = serialized;
  }

  const cos = storeCosParam(req);
  if (cos) payload.StoreCosParam = cos;

  const operator = trimmed(req.operator);
  if (operator) payload.Operator = operator;

  return payload;
}

function analysisPayload(req, model) {
  const payload = inputObject(req.vendor_body, "vendor_body");
  const mvc = analysisExtendedParameter(payload);
  const expected = ANALYSIS_MODELS[model].modelName;
  const actual = trimmed(mvc.model);
  if (expected && actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("multimodal understanding model does not match the selected task model");
  }
  return payload;
}

export function buildSubmitRequest(ctx) {
  const req = plainObject(ctx.requestBody);
  const model = upstreamModel(ctx);
  const split = splitModel(model);
  const spec = modelSpec(split.name);
  let payload;
  let action;
  if (SCENARIO_MODELS[split.name]) {
    payload = inputObject(req.vendor_body, "vendor_body");
    action = trimmed(req.scenario_action);
    if (
      action !== ACTION_CREATE_DOC_VIDEO &&
      action !== ACTION_MODIFY_DOC_VIDEO &&
      action !== ACTION_CREATE_FISSION &&
      action !== ACTION_CLONE_VIRAL
    ) {
      throw new Error("unsupported Tencent MPS scenario action");
    }
    if (action === ACTION_MODIFY_DOC_VIDEO) {
      const input = inputObject(payload.Input, "Input");
      const publicID = trimmed(input.SourceTaskId);
      let upstreamID = "";
      for (const task of Array.isArray(ctx.originTasks) ? ctx.originTasks : []) {
        if (trimmed(task && task.taskId) === publicID) {
          const originAction = trimmed(task.action);
          if (
            originAction !== "document_to_video" &&
            originAction !== "document_to_video_confirm" &&
            originAction !== "document_to_video_regenerate"
          ) {
            throw new Error("source task is not a document-to-video task");
          }
          upstreamID = trimmed(task.upstreamTaskId);
          break;
        }
      }
      if (!upstreamID) throw new Error("source document-to-video task is unavailable");
      payload = Object.assign({}, payload, { Input: Object.assign({}, input, { SourceTaskId: upstreamID }) });
    }
  } else if (ANALYSIS_MODELS[split.name]) {
    payload = analysisPayload(req, split.name);
    action = ACTION_PROCESS_MEDIA;
  } else if (VIDEO_MODELS[split.name]) {
    payload = videoPayload(req, split.name);
    action = ACTION_CREATE_VIDEO;
  } else if (AUDIO_MODELS[split.name]) {
    payload = audioPayload(req, split.name);
    action = ACTION_CREATE_AUDIO;
  } else {
    payload = imagePayload(req, split.name);
    action = ACTION_CREATE_IMAGE;
  }
  if (split.version) payload.ModelVersion = split.version;
  else if (!spec.modelVersion) delete payload.ModelVersion;
  return vendorRequest(ctx, action, payload);
}

export function parseSubmitResponse(ctx, response) {
  const body = plainObject(response).body;
  const error = vendorError(body);
  if (error) throw new Error(error);
  const vendor = vendorResponse(body);
  if (trimmed(vendor.Status).toUpperCase() === "FAIL") {
    throw new Error(trimmed(vendor.Message) || "Tencent MPS task creation failed");
  }
  const taskId = trimmed(vendor.TaskId);
  if (!taskId) throw new Error("Tencent MPS returned no task id");
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  const model = upstreamModel(ctx);
  const name = splitModel(model).name;
  let action = ACTION_DESCRIBE_IMAGE;
  if (SCENARIO_MODELS[name]) {
    action = SCENARIO_MODELS[name].scenario === "viral" ? ACTION_DESCRIBE_CLONE_VIRAL : ACTION_DESCRIBE_SCENARIO;
  } else if (ANALYSIS_MODELS[name]) action = ACTION_DESCRIBE_TASK_DETAIL;
  else if (VIDEO_MODELS[name]) action = ACTION_DESCRIBE_VIDEO;
  else if (AUDIO_MODELS[name]) action = ACTION_DESCRIBE_AUDIO;
  return vendorRequest(ctx, action, { TaskId: trimmed(ctx.taskId) });
}

export function parseTaskResult(ctx, body) {
  const error = vendorError(body);
  if (error) throw new Error(error);
  const response = vendorResponse(body);
  const model = upstreamModel(ctx);
  const name = splitModel(model).name;
  if (SCENARIO_MODELS[name] !== undefined) {
    const spec = SCENARIO_MODELS[name];
    if (spec.scenario === "viral") {
      const status = trimmed(response.Status).toUpperCase();
      if (status === "WAIT") return { status: "QUEUED", progress: "10%" };
      if (status === "RUN") return { status: "IN_PROGRESS", progress: "50%" };
      if (status === "FAIL") {
        return { status: "FAILURE", progress: "100%", reason: trimmed(response.Message) || "Tencent MPS viral clone task failed" };
      }
      if (status !== "DONE") {
        return { status: "UNKNOWN", reason: "unrecognized Tencent MPS status: " + trimmed(response.Status) };
      }
      const videos = outputUrls(body, "VideoUrls", "videoUrls");
      if (!videos.length) throw new Error("Tencent MPS reported DONE without an output url");
      return { status: "SUCCESS", progress: "100%", url: videos[0], videoUrls: videos };
    }
    const status = trimmed(response.TaskStatus).toUpperCase();
    if (status === "PENDING") return { status: "QUEUED", progress: "10%" };
    if (status === "RUNNING") return { status: "IN_PROGRESS", progress: "50%" };
    if (status === "FAILED" || status === "STOP" || status === "TIMEOUT") {
      return {
        status: "FAILURE",
        progress: "100%",
        reason: trimmed(response.TaskResultMsg) || "Tencent MPS scenario task " + status.toLowerCase(),
      };
    }
    if (status !== "FINISHED") {
      return { status: "UNKNOWN", reason: "unrecognized Tencent MPS task status: " + trimmed(response.TaskStatus) };
    }
    const url = trimmed(response.OutputUrl);
    if (!url) throw new Error("Tencent MPS reported FINISHED without an output url");
    return { status: "SUCCESS", progress: "100%", url: url, outputUrl: url };
  }
  if (ANALYSIS_MODELS[name] !== undefined) {
    const analysisStatus = trimmed(response.Status).toUpperCase();
    if (analysisStatus === "WAITING") return { status: "QUEUED", progress: "10%" };
    if (analysisStatus === "PROCESSING") return { status: "IN_PROGRESS", progress: "50%" };
    if (analysisStatus !== "FINISH") {
      return { status: "UNKNOWN", reason: "unrecognized Tencent MPS status: " + trimmed(response.Status) };
    }
    const workflow = plainObject(response.WorkflowTask);
    const workflowError = Number(workflow.ErrCode);
    if (Number.isFinite(workflowError) && workflowError !== 0) {
      return { status: "FAILURE", progress: "100%", reason: trimmed(workflow.Message) || "Tencent MPS analysis task failed" };
    }
    const results = Array.isArray(workflow.AiAnalysisResultSet) ? workflow.AiAnalysisResultSet : [];
    for (const item of results) {
      const task = plainObject(plainObject(item).VideoComprehensionTask);
      if (!Object.keys(task).length) continue;
      const taskStatus = trimmed(task.Status).toUpperCase();
      if (taskStatus === "FAIL" || taskStatus === "FAILED") {
        return { status: "FAILURE", progress: "100%", reason: trimmed(task.Message) || "Tencent MPS analysis task failed" };
      }
      if (taskStatus === "SUCCESS") {
        const output = trimmed(plainObject(task.Output).VideoComprehensionAnalysisResult);
        if (!output) {
          return { status: "FAILURE", progress: "100%", reason: "Tencent MPS analysis task returned no result" };
        }
        return { status: "SUCCESS", progress: "100%", text: output };
      }
    }
    return { status: "FAILURE", progress: "100%", reason: "Tencent MPS returned no multimodal understanding result" };
  }
  const status = trimmed(response.Status).toUpperCase();
  if (status === "WAIT" || status === "PENDING") return { status: "QUEUED", progress: "10%" };
  if (status === "RUN" || status === "RUNNING") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "DONE" || status === "SUCCESS") {
    const isVideo = VIDEO_MODELS[name] !== undefined;
    const isAudio = AUDIO_MODELS[name] !== undefined;
    if (isAudio) {
      const audioInfos = outputInfo(body, "AudioInfos", "audioInfos");
      const videoInfos = outputInfo(body, "VideoInfos", "videoInfos");
      if (!audioInfos.length && !videoInfos.length) {
        throw new Error("Tencent MPS reported DONE without an output url");
      }
      const first = audioInfos.length ? audioInfos[0].url : videoInfos[0].url;
      const result = { status: "SUCCESS", progress: "100%", url: first };
      if (audioInfos.length) result.audioInfos = audioInfos;
      if (videoInfos.length) result.videoInfos = videoInfos;
      return result;
    }
    const listed = isVideo ? response.VideoUrls : response.ImageUrls;
    const urls = [];
    const entries = Array.isArray(listed) ? listed : [];
    for (const item of entries) {
      const url = trimmed(item);
      if (url) urls.push(url);
    }
    if (!urls.length) throw new Error("Tencent MPS reported DONE without an output url");
    const result = { status: "SUCCESS", progress: "100%", url: urls[0] };
    if (isVideo) {
      result.videoUrls = urls;
      const resolution = trimmed(response.Resolution);
      if (resolution) result.resolution = resolution;
    } else {
      result.imageUrls = urls;
    }
    return result;
  }
  if (status === "FAIL" || status === "FAILED") {
    return { status: "FAILURE", progress: "100%", reason: trimmed(response.Message) || "Tencent MPS task failed" };
  }
  return { status: "UNKNOWN", reason: "unrecognized Tencent MPS status: " + trimmed(response.Status) };
}

// The vendor's own output list is the artifact set. The gateway serves each
// one at its own content address, so the client never sees the vendor's
// expiring URL.
export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const data = plainObject(task.data);
  const urls = outputUrls(data, "ImageUrls", "imageUrls");
  const artifacts = [];
  let index = 0;
  for (const url of urls) {
    index += 1;
    artifacts.push({ key: "image-" + index, type: "image" });
  }
  const videos = outputUrls(data, "VideoUrls", "videoUrls");
  index = 0;
  for (const url of videos) {
    index += 1;
    artifacts.push({ key: "video-" + index, type: "video", mimeType: "video/mp4" });
  }
  const scenarioURL = trimmed(plainObject(plainObject(task.data).Response).OutputUrl || plainObject(task.data).outputUrl);
  if (scenarioURL) artifacts.push({ key: "scenario-video", type: "video", mimeType: "video/mp4" });
  const audioInfos = outputInfo(data, "AudioInfos", "audioInfos");
  index = 0;
  for (const info of audioInfos) {
    index += 1;
    artifacts.push({ key: "audio-" + index, type: "audio" });
  }
  const audioVideos = outputInfo(data, "VideoInfos", "videoInfos");
  index = 0;
  for (const info of audioVideos) {
    index += 1;
    artifacts.push({ key: "audio-video-" + index, type: "video", mimeType: "video/mp4" });
  }
  return artifacts;
}

export function buildContentRequest(ctx) {
  const data = plainObject(ctx.data);
  const key = String(ctx.artifactKey || "");
  const image = /^image-(\d+)$/.exec(key);
  const video = /^video-(\d+)$/.exec(key);
  const audio = /^audio-(\d+)$/.exec(key);
  const audioVideo = /^audio-video-(\d+)$/.exec(key);
  let url = "";
  if (image) {
    const urls = outputUrls(data, "ImageUrls", "imageUrls");
    const index = Number(image[1]) - 1;
    url = index >= 0 && index < urls.length ? trimmed(urls[index]) : "";
  } else if (video) {
    const urls = outputUrls(data, "VideoUrls", "videoUrls");
    const index = Number(video[1]) - 1;
    url = index >= 0 && index < urls.length ? trimmed(urls[index]) : "";
  } else if (audio) {
    const infos = outputInfo(data, "AudioInfos", "audioInfos");
    const index = Number(audio[1]) - 1;
    url = index >= 0 && index < infos.length ? infos[index].url : "";
  } else if (audioVideo) {
    const infos = outputInfo(data, "VideoInfos", "videoInfos");
    const index = Number(audioVideo[1]) - 1;
    url = index >= 0 && index < infos.length ? infos[index].url : "";
  } else if (key === "scenario-video") {
    url = trimmed(plainObject(data.Response).OutputUrl || data.outputUrl);
  }
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

// The submit-time facts reserve the requested output. A video task reserves
// its requested duration; the vendor bills the produced duration, which the
// completion facts replace.
export function extractUsage(ctx) {
  const req = plainObject(ctx.requestBody);
  const model = upstreamModel(ctx);
  const name = splitModel(model).name;
  if (SCENARIO_MODELS[name] !== undefined) {
    const spec = SCENARIO_MODELS[name];
    if (spec.scenario === "fission") {
      const seconds = Number(req.seconds);
      if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) {
        throw new Error("TaskInfo.Duration must be an integer between 4 and 15");
      }
      return { seconds: seconds };
    }
    if (spec.scenario === "doc_control") {
      const input = plainObject(plainObject(req.vendor_body).Input);
      return { scenario_count: trimmed(input.Action) === "regenerate" ? 1 : 0 };
    }
    return { scenario_count: 1 };
  }
  if (ANALYSIS_MODELS[name] !== undefined) return { analysis_count: 1 };
  if (VIDEO_MODELS[name] !== undefined) {
    return { seconds: videoDuration(req, VIDEO_MODELS[name], true) };
  }
  if (AUDIO_MODELS[name] !== undefined) {
    let count = 1;
    const additional = req.additional_parameters;
    if (additional !== undefined && additional !== null) {
      let parsed;
      try {
        parsed = typeof additional === "string"
          ? inputObject(JSON.parse(additional), "additional_parameters")
          : inputObject(additional, "additional_parameters");
      } catch (error) {
        if (String(error && error.message).includes("must be an object")) throw error;
        throw new Error("additional_parameters must be a JSON object string");
      }
      if (parsed.n !== undefined && parsed.n !== null) count = Number(parsed.n);
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_AUDIO_OUTPUTS) {
      throw new Error("additional_parameters.n must be an integer between 1 and " + MAX_AUDIO_OUTPUTS);
    }
    return { audio_count: count };
  }
  const count = req.n === undefined || req.n === null ? 1 : Number(req.n);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_OUTPUTS) {
    throw new Error("n must be an integer between 1 and " + MAX_IMAGE_OUTPUTS);
  }
  const payload = imagePayload(req, model);
  let resolution = trimmed(plainObject(payload.ExtraParameters).Resolution) || "1080P";
  const size = trimmed(payload.AdditionalParameters ? JSON.parse(payload.AdditionalParameters).size : "");
  if (size) {
    const dimensions = size.toLowerCase().split("x").map(Number);
    const edge = Math.max(dimensions[0], dimensions[1]);
    resolution = edge > 2048 ? "4K" : edge > 1080 ? "2K" : "1080P";
  }
  return { image_count: count, resolution: resolution, reference_count: (payload.ImageInfos || []).length };
}

// MPS reports no token usage. Image and audio tasks bill the outputs they
// produced; a video task bills the duration it produced.
export function extractUsageOnComplete(ctx, taskResult, body) {
  const model = upstreamModel(ctx);
  const name = splitModel(model).name;
  if (SCENARIO_MODELS[name] !== undefined) {
    const scenario = SCENARIO_MODELS[name].scenario;
    // The scenario query APIs do not return exact output duration. Preserve
    // the bounded reservation for fission and document control tasks; the
    // remaining scenario families settle at one successful task.
    if (scenario === "fission" || scenario === "doc_control") return {};
    return { scenario_count: 1 };
  }
  if (ANALYSIS_MODELS[name] !== undefined) return { analysis_count: 1 };
  if (AUDIO_MODELS[name] !== undefined) {
    const audios = outputInfo(body, "AudioInfos", "audioInfos");
    const videos = outputInfo(body, "VideoInfos", "videoInfos");
    const count = audios.length || videos.length;
    if (count > 0 && count <= MAX_AUDIO_OUTPUTS) return { audio_count: count };
    return {};
  }
  const images = outputUrls(body, "ImageUrls", "imageUrls");
  if (images.length > 0 && images.length <= MAX_IMAGE_OUTPUTS) {
    return { image_count: images.length };
  }
  // DescribeAigcVideoTask does not return the produced duration. Leaving the
  // completion facts empty preserves the bounded duration reserved from the
  // submitted request instead of guessing a lower charge.
  return {};
}

export const native = {
  mpsTask: function (ctx) {
    const action = requestHeader(ctx, "X-TC-Action");
    const version = requestHeader(ctx, "X-TC-Version");
    if (version && version !== VERSION) throw new Error("X-TC-Version must be " + VERSION);
    const body = jsonBody(ctx);
    if (
      action === ACTION_DESCRIBE_IMAGE ||
      action === ACTION_DESCRIBE_VIDEO ||
      action === ACTION_DESCRIBE_AUDIO ||
      action === ACTION_DESCRIBE_TASK_DETAIL ||
      action === ACTION_DESCRIBE_SCENARIO ||
      action === ACTION_DESCRIBE_CLONE_VIRAL
    ) {
      const taskID = trimmed(body.TaskId);
      if (!taskID) throw new Error("TaskId is required");
      return { kind: "query", taskIds: [taskID] };
    }
    if (action === ACTION_CREATE_IMAGE) {
      const model = mpsImageModel(body.ModelName, body.ModelVersion);
      const requestBody = mpsNativeImageRequest(body);
      const references = Array.isArray(requestBody.images) ? requestBody.images.length : 0;
      return {
        kind: "submit",
        model: model,
        action: references ? "image_to_image" : "text_to_image",
        requestBody: requestBody,
      };
    }
    if (action === ACTION_CREATE_VIDEO) {
      const model = mpsVideoModel(body.ModelName, body.ModelVersion);
      const requestBody = mpsNativeVideoRequest(body);
      const hasImage = trimmed(requestBody.image) || (Array.isArray(requestBody.images) && requestBody.images.length > 0);
      const hasVideo = Array.isArray(requestBody.video_infos) && requestBody.video_infos.length > 0;
      return {
        kind: "submit",
        model: model,
        action: hasVideo ? "video_to_video" : hasImage ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    }
    if (action === ACTION_CREATE_AUDIO) {
      const model = mpsAudioModel(body.ModelName, body.ModelVersion);
      const requestBody = mpsNativeAudioRequest(body);
      const hasAudio = Array.isArray(requestBody.audio_infos) && requestBody.audio_infos.length > 0;
      const hasVideo = Array.isArray(requestBody.video_infos) && requestBody.video_infos.length > 0;
      return {
        kind: "submit",
        model: model,
        action: hasAudio ? "audio_to_audio" : hasVideo ? "video_to_audio" : "text_to_audio",
        requestBody: requestBody,
      };
    }
    if (action === ACTION_PROCESS_MEDIA) {
      const requestBody = mpsNativeAnalysisRequest(body);
      const mvc = analysisExtendedParameter(plainObject(requestBody.vendor_body));
      return {
        kind: "submit",
        model: mpsAnalysisModel(mvc.model),
        action: "multimodal_understanding",
        requestBody: requestBody,
      };
    }
    if (action === ACTION_CREATE_DOC_VIDEO) {
      const decoded = mpsNativeDocVideoRequest(body);
      return {
        kind: "submit",
        model: decoded.model,
        action: "document_to_video",
        requestBody: decoded.requestBody,
      };
    }
    if (action === ACTION_MODIFY_DOC_VIDEO) {
      const decoded = mpsNativeDocVideoControlRequest(body);
      return {
        kind: "submit",
        model: decoded.model,
        action: trimmed(plainObject(body.Input).Action) === "regenerate" ? "document_to_video_regenerate" : "document_to_video_confirm",
        requestBody: decoded.requestBody,
        originTaskIds: [decoded.sourceTaskID],
      };
    }
    if (action === ACTION_CREATE_FISSION) {
      const decoded = mpsNativeFissionRequest(body);
      return {
        kind: "submit",
        model: decoded.model,
        action: "video_fission",
        requestBody: decoded.requestBody,
      };
    }
    if (action === ACTION_CLONE_VIRAL) {
      const decoded = mpsNativeViralRequest(body);
      return {
        kind: "submit",
        model: decoded.model,
        action: decoded.requestBody.scenario_mode === "depth" ? "video_depth" : "viral_clone",
        requestBody: decoded.requestBody,
      };
    }
    throw new Error(
      "X-TC-Action must be a supported MPS AIGC, scenario, or multimodal understanding action",
    );
  },
  mpsTaskResult: function (ctx, value) {
    const querying = Array.isArray(value);
    const task = querying ? value[0] : value;
    const stored = storedMPSResponse(task);
    if (!querying) {
      return {
        Response: {
          TaskId: trimmed(task && task.task_id),
          RequestId: trimmed(stored.RequestId),
        },
      };
    }
    const response = {
      Status: mpsTaskStatus(task),
      RequestId: trimmed(stored.RequestId),
    };
    if (stored.TaskType || stored.WorkflowTask !== undefined) return { Response: stored };
    const model = splitModel(taskModelName(task)).name;
    const scenario = SCENARIO_MODELS[model];
    if (scenario && scenario.scenario !== "viral") {
      const scenarioResponse = {
        TaskId: trimmed(task && task.task_id),
        TaskStatus: trimmed(stored.TaskStatus) || mpsScenarioTaskStatus(task),
        RequestId: trimmed(stored.RequestId),
      };
      if (trimmed(stored.OutputUrl)) scenarioResponse.OutputUrl = trimmed(stored.OutputUrl);
      if (stored.Stage !== undefined) scenarioResponse.Stage = stored.Stage;
      if (stored.TaskInfo !== undefined) scenarioResponse.TaskInfo = stored.TaskInfo;
      if (stored.TaskType !== undefined) scenarioResponse.TaskType = stored.TaskType;
      if (stored.TaskResultCode !== undefined) scenarioResponse.TaskResultCode = stored.TaskResultCode;
      if (stored.TaskResultMsg !== undefined) scenarioResponse.TaskResultMsg = stored.TaskResultMsg;
      return { Response: scenarioResponse };
    }
    if (response.Status === "DONE") {
      const images = outputUrls(task.data, "ImageUrls", "imageUrls");
      if (images.length) response.ImageUrls = images;
      const videos = outputUrls(task.data, "VideoUrls", "videoUrls");
      if (videos.length) response.VideoUrls = videos;
      const resolution = trimmed(stored.Resolution || plainObject(task.data).resolution);
      if (resolution) response.Resolution = resolution;
      const audioInfos = outputInfo(task.data, "AudioInfos", "audioInfos");
      if (audioInfos.length) {
        response.AudioInfos = audioInfos.map(function (info) {
          const output = { Url: info.url };
          if (info.duration !== undefined) output.Duration = info.duration;
          return output;
        });
      }
      const videoInfos = outputInfo(task.data, "VideoInfos", "videoInfos");
      if (videoInfos.length) {
        response.VideoInfos = videoInfos.map(function (info) {
          const output = { Url: info.url };
          if (info.duration !== undefined) output.Duration = info.duration;
          return output;
        });
      }
    }
    if (response.Status === "FAIL") response.Message = trimmed(task.fail_reason) || trimmed(stored.Message) || "task failed";
    else if (trimmed(stored.Message)) response.Message = trimmed(stored.Message);
    return { Response: response };
  },
  error: function (ctx, error) {
    const message = trimmed(error && error.message) || "request failed";
    const requestID = trimmed(error && error.requestId);
    return {
      Response: {
        Error: { Code: String(error.code || "InvalidParameter"), Message: message },
        RequestId: requestID,
      },
    };
  },
};

export const protocols = {
  openai_image: {
    decodeRequest: function (ctx) {
      const model = trimmed(ctx.model);
      if (!model) throw new Error("model is required");
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = plainObject(ctx.body.value);
      if (Object.prototype.hasOwnProperty.call(req, "stream") && req.stream === true) {
        throw new Error("stream is not supported; the complete image response is returned once all images are generated");
      }
      if (req.response_format !== undefined && req.response_format !== "url" && req.response_format !== "b64_json") {
        throw new Error("response_format must be url or b64_json");
      }
      if (req.mask !== undefined) throw new Error("mask is not supported by Tencent MPS");
      // The vendor names its fields differently; the plugin reads the
      // OpenAI Images body plus the vendor extras.
      const vendorReq = {};
      for (const key of [
        "prompt",
        "n",
        "size",
        "negative_prompt",
        "enhance_prompt",
        "scene_type",
        "image",
        "images",
        "extra_parameters",
        "additional_parameters",
        "store_cos_param",
        "operator",
      ]) {
        if (Object.prototype.hasOwnProperty.call(req, key) && req[key] !== undefined) vendorReq[key] = req[key];
      }
      const references = []
        .concat(vendorReq.image === undefined ? [] : vendorReq.image)
        .concat(vendorReq.images === undefined ? [] : vendorReq.images);
      if (ctx.operation === "edit" && !references.length) throw new Error("image is required");
      return { kind: "submit", model: model, action: references.length ? "image_to_image" : "text_to_image", requestBody: vendorReq };
    },
    render: function (ctx, task) {
      const data = plainObject(task.data);
      const urls = outputUrls(data, "ImageUrls", "imageUrls");
      const entries = [];
      for (const item of urls) {
        const url = trimmed(item);
        if (url) entries.push({ url: url });
      }
      return { created: task.created_at, data: entries };
    },
  },
  openai_video: {
    decodeRequest: function (ctx) {
      const model = trimmed(ctx.model);
      if (!model) throw new Error("model is required");
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = plainObject(ctx.body.value);
      const seconds = req.seconds === undefined ? req.duration : req.seconds;
      if (seconds !== undefined && seconds !== null) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value < 1 || value > MAX_VIDEO_SECONDS) {
          throw new Error("seconds must be between 1 and " + MAX_VIDEO_SECONDS);
        }
      }
      const vendorReq = {};
      for (const key of [
        "prompt",
        "seconds",
        "duration",
        "image",
        "last_image",
        "images",
        "video_infos",
        "audio_infos",
        "subject_infos",
        "negative_prompt",
        "enhance_prompt",
        "scene_type",
        "extra_parameters",
        "additional_parameters",
        "store_cos_param",
        "operator",
      ]) {
        if (Object.prototype.hasOwnProperty.call(req, key) && req[key] !== undefined) vendorReq[key] = req[key];
      }
      return {
        kind: "submit",
        model: model,
        action: vendorReq.video_infos
          ? "video_to_video"
          : vendorReq.image || vendorReq.images
            ? "image_to_video"
            : "text_to_video",
        requestBody: vendorReq,
      };
    },
    render: function (ctx, task) {
      const data = plainObject(task.data);
      const urls = outputUrls(data, "VideoUrls", "videoUrls");
      const statusMap = {
        QUEUED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      const output = {
        id: task.task_id,
        object: "video",
        model: task.properties ? task.properties.origin_model_name || "" : "",
        status: statusMap[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at,
        completed_at: task.updated_at,
      };
      const first = trimmed(urls[0]);
      if (first) output.url = first;
      return output;
    },
  },
};
