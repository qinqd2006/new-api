// Tencent Cloud TokenHub generation-model catalog and WAND-Vega image relay.
//
// TokenHub is a separate service from Tencent MPS: it uses a Bearer API key,
// its own hostname and native request paths, and reports the actual billable
// quantity as usage.total_tokens when the asynchronous task completes.

const VEGA_IMAGE_MODELS = [
  "wand-vega-image-lite",
  "wand-vega-image-flash",
  "wand-vega-image-pro",
  "wand-vega-image-1.5-pro",
];

const IMAGE_MODELS = [
  "hy-image-v3.5-preview",
  ...VEGA_IMAGE_MODELS,
  "hidream-image-o1-1.5",
  "hidream-image-o1-1.5-edit",
  "kling-image-v3",
  "kling-image-o1",
  "kling-image-v3-omni",
  "vidu-image-q2",
  "seedream-image-v5.0-flash",
  "seedream-image-v5.0-pro",
  "seedream-image-v5.0-lite",
];

const VIDEO_TOKEN_MODELS = [
  "wand-vega-video-1.0-lite",
  "minimax-video-h3-max",
  "minimax-video-h3",
  "minimax-video-v2.3",
  "minimax-video-v2.3-fast",
  "kling-video-v4",
  "kling-video-v4-flash",
  "kling-video-motion-control-v3.0",
  "kling-video-motion-control-v2.6",
  "kling-video-v3",
  "kling-video-v3-omni",
  "kling-video-v3-turbo",
  "kling-video-v2.6",
  "kling-video-v2.5-turbo",
  "kling-video-o1",
  "vidu-video-q4-preview",
  "vidu-video-q3-pro",
  "vidu-video-q3-turbo",
  "vidu-video-q3",
  "vidu-video-q2",
  "vidu-video-q2-pro",
  "vidu-video-q2-turbo",
  "pixverse-video-v6.0",
  "pixverse-video-v5.6",
  "pixverse-video-c1",
];

const VIDEO_SECONDS_MODELS = [
  // The model-list page currently uses hy-video-1.5 while the calling guide
  // uses hy-video-v1.5. Keep both spellings so either upstream catalog works.
  "hy-video-1.5",
  "hy-video-v1.5",
  "yt-video-2.0",
  "yt-video-humanactor",
  "yt-video-fx",
];

const THREE_D_MODELS = [
  "hy-world2-panorama",
  "hy-world2-scene",
  "hy-3d-3.0",
  "hy-3d-3.1",
  "hy-3d-express",
  "hy-3d-component",
  "hy-3d-format",
  "hy-3d-motion",
  "hy-3d-retopology",
  "hy-3d-rigging",
  "hy-3d-texture",
  "hy-3d-uv",
  "hy-3d-polygen-mesh",
  "hy-3d-polygen-image",
  "miora-3d",
  "miora-3d-1.2",
  "miora-3d-t1",
  "tripo-3d-3.1",
  "tripo-3d-p1",
  "tripo-3d-p2",
  "tripo-3d-rigging-check",
  "tripo-3d-rigging",
  "tripo-3d-animation",
  "tripo-3d-format",
  "hi3d-2.1",
  "hi3d-3.0",
  "rodin-gen-3d-2.5",
];

const AUDIO_MODELS = [
  "minimax-music-v2.6",
  "minimax-music-v3.0",
  "mureka-music-v9",
  "tenlai-tts-v1.0",
  "indextts-2",
  "minimax-speech-2.8-hd",
  "minimax-speech-2.8-turbo",
  "minimax-speech-2.6-hd",
  "minimax-speech-2.6-turbo",
  "minimax-speech-02-hd",
  "minimax-speech-02-turbo",
  "minimax-voice-clone",
  "minimax-voice-design",
  "wand-dubbing-clone-v1",
  "wand-dubbing-clone-v2",
  "wand-dubbing-sts-v1",
  "tenlai-asr-v1.0",
  "wand-asr-v1",
  "hy-asr-3.0-preview",
];

const MODELS = [
  ...IMAGE_MODELS,
  ...VIDEO_TOKEN_MODELS,
  ...VIDEO_SECONDS_MODELS,
  ...THREE_D_MODELS,
  ...AUDIO_MODELS,
];

const THREE_D_TASK_MODELS = THREE_D_MODELS.filter(function (model) {
  return model !== "hy-world2-panorama" && model !== "hy-world2-scene";
});

const NATIVE_TASK_SPECS = {
  hunyuan_image_v35: { path: "/v1/wand/hunyuan-image/v35-generation", sync: true, artifact: "image", models: ["hy-image-v3.5-preview"] },
  vidu_image: { path: "/v1/wand/vidu-image/generation", queryPath: "/v1/wand/vidu-image/tasks/:task_id", artifact: "image", models: ["vidu-image-q2"] },
  seedream_image: { path: "/v1/wand/si-image/generation", sync: true, artifact: "image", models: ["seedream-image-v5.0-flash", "seedream-image-v5.0-pro", "seedream-image-v5.0-lite"] },
  kling_image: { path: "/v1/wand/kling-image/generation", queryPath: "/v1/wand/kling-image/tasks/:task_id", artifact: "image", models: ["kling-image-v3", "kling-image-o1", "kling-image-v3-omni"] },
  hidream_image: { path: "/v1/wand/hidream-image/images/generations", sync: true, artifact: "image", models: ["hidream-image-o1-1.5"] },
  hidream_image_edit: { path: "/v1/wand/hidream-image/images/edits", sync: true, artifact: "image", models: ["hidream-image-o1-1.5-edit"] },
  vega_video: { path: "/v1/wand/vega-videos/tasks", queryPath: "/v1/wand/vega-videos/tasks/:task_id", artifact: "video", models: ["wand-vega-video-1.0-lite"] },
  hunyuan_video: { path: "/v1/wand/hunyuan-video/generation", queryPath: "/v1/wand/hunyuan-video/tasks/:task_id", artifact: "video", models: ["hy-video-1.5", "hy-video-v1.5"] },
  vidu_text_video: { path: "/v1/wand/vidu/text-to-video", queryPath: "/v1/wand/vidu/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("vidu-video-") === 0; }) },
  vidu_image_video: { path: "/v1/wand/vidu/image-to-video", queryPath: "/v1/wand/vidu/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("vidu-video-") === 0; }) },
  vidu_reference_video: { path: "/v1/wand/vidu/reference-to-video", queryPath: "/v1/wand/vidu/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("vidu-video-") === 0; }) },
  vidu_frames_video: { path: "/v1/wand/vidu/start-end-to-video", queryPath: "/v1/wand/vidu/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("vidu-video-") === 0; }) },
  pixverse_text_video: { path: "/v1/wand/pixverse/text-to-video", queryPath: "/v1/wand/pixverse/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("pixverse-video-") === 0; }) },
  pixverse_image_video: { path: "/v1/wand/pixverse/image-to-video", queryPath: "/v1/wand/pixverse/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("pixverse-video-") === 0; }) },
  pixverse_frames_video: { path: "/v1/wand/pixverse/start-end-to-video", queryPath: "/v1/wand/pixverse/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("pixverse-video-") === 0; }) },
  pixverse_reference_video: { path: "/v1/wand/pixverse/reference-to-video", queryPath: "/v1/wand/pixverse/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("pixverse-video-") === 0; }) },
  kling_text_video: { path: "/v1/wand/kling/text-to-video", queryPath: "/v1/wand/kling/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("kling-video-") === 0 && model.indexOf("motion-control") < 0; }) },
  kling_image_video: { path: "/v1/wand/kling/image-to-video", queryPath: "/v1/wand/kling/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("kling-video-") === 0 && model.indexOf("motion-control") < 0; }) },
  kling_omni_video: { path: "/v1/wand/kling/omni-video", queryPath: "/v1/wand/kling/tasks/:task_id", artifact: "video", models: ["kling-video-v4", "kling-video-v3-omni", "kling-video-o1"] },
  kling_motion_video: { path: "/v1/wand/kling/motion-control", queryPath: "/v1/wand/kling/tasks/:task_id", artifact: "video", models: ["kling-video-motion-control-v3.0", "kling-video-motion-control-v2.6"] },
  minimax_video: { path: "/v1/wand/minimax-video-v2/generation", queryPath: "/v1/wand/minimax-video-v2/tasks/:task_id", artifact: "video", models: VIDEO_TOKEN_MODELS.filter(function (model) { return model.indexOf("minimax-video-") === 0; }) },
  yt_video: { path: "/v1/api/video/submit", queryPath: "/v1/api/video/query", queryMethod: "POST", queryIdField: "id", queryModel: true, artifact: "video", models: ["yt-video-2.0", "yt-video-humanactor", "yt-video-fx"] },
  world_panorama: { path: "/v1/wand/hunyuan-image/world2-panorama", sync: true, artifact: "image", models: ["hy-world2-panorama"] },
  world_scene: { path: "/v1/wand/hunyuan-video/world2-scene", queryPath: "/v1/wand/hunyuan-video/tasks/:task_id", artifact: "file", models: ["hy-world2-scene"] },
  three_d: { path: "/v1/api/3d/submit", queryPath: "/v1/api/3d/query", queryMethod: "POST", queryIdField: "id", queryModel: true, artifact: "file", models: THREE_D_TASK_MODELS },
  tenlai_asr: { path: "/v1/tenlai/asrproxy/create_rec_task", queryPath: "/v1/tenlai/asrproxy/describe_task_status", queryMethod: "POST", queryIdField: "task_id", artifact: "file", models: ["tenlai-asr-v1.0"] },
  hy_asr: { path: "/v1/wand/asrproxy/async_create", queryPath: "/v1/wand/asrproxy/async_query", queryMethod: "POST", queryIdField: "task_id", artifact: "file", models: ["hy-asr-3.0-preview"] },
  wand_async_asr: { path: "/v1/wand/wx-asr/async-asr", queryPath: "/v1/wand/wx-asr/async-query", queryMethod: "POST", queryIdField: "task_id", artifact: "file", models: ["wand-asr-v1"] },
  wand_sync_asr: { path: "/v1/wand/asrproxy/sync_transcribe", sync: true, artifact: "file", models: ["wand-asr-v1"] },
  tenlai_tts: { path: "/v1/tenlai/ttsproxy/text_to_voice", sync: true, artifact: "audio", models: ["tenlai-tts-v1.0"] },
  minimax_tts: { path: "/v1/wand/minimax-tts/sync-tts", sync: true, artifact: "audio", models: ["minimax-speech-2.8-hd", "minimax-speech-2.8-turbo", "minimax-speech-2.6-hd", "minimax-speech-2.6-turbo", "minimax-speech-02-hd", "minimax-speech-02-turbo"] },
  minimax_voice_clone: { path: "/v1/wand/minimax-tts/sync_clone", sync: true, artifact: "audio", models: ["minimax-voice-clone"] },
  minimax_voice_design: { path: "/v1/wand/minimax-tts/sync_design", sync: true, artifact: "audio", models: ["minimax-voice-design"] },
  minimax_music: { path: "/v1/wand/minimax-music/generation", sync: true, artifact: "audio", models: ["minimax-music-v2.6", "minimax-music-v3.0"] },
  mureka_music: { path: "/v1/wand/mureka-music/generation", sync: true, artifact: "audio", models: ["mureka-music-v9"] },
  mureka_music_easy: { path: "/v1/wand/mureka-music/easy-generation", sync: true, artifact: "audio", models: ["mureka-music-v9"] },
  dubbing: { path: "/v1/wand/dubbing/async_generation", queryPath: "/v1/wand/dubbing/tasks/:task_id", artifact: "video", models: ["wand-dubbing-clone-v1", "wand-dubbing-clone-v2"] },
};

const CATALOG_ROUTES = [];
const CATALOG_QUERY_ROUTES = {};
for (const action of Object.keys(NATIVE_TASK_SPECS)) {
  const spec = NATIVE_TASK_SPECS[action];
  CATALOG_ROUTES.push({
    method: "POST",
    path: spec.path,
    type: "submit",
    decode: "catalogTask",
    render: "catalogResult",
    models: spec.models,
    retainResult: spec.sync ? false : true,
  });
  if (spec.queryPath && spec.queryMethod !== "POST") {
    if (!CATALOG_QUERY_ROUTES[spec.queryPath]) {
      CATALOG_ROUTES.push({ method: "GET", path: spec.queryPath, type: "query", render: "catalogResult" });
      CATALOG_QUERY_ROUTES[spec.queryPath] = true;
    }
  }
}
CATALOG_ROUTES.push(
  { method: "POST", path: "/v1/api/video/query", type: "dynamic", decode: "catalogQuery", render: "catalogResult" },
  { method: "POST", path: "/v1/api/3d/query", type: "dynamic", decode: "catalogQuery", render: "catalogResult" },
  { method: "POST", path: "/v1/tenlai/asrproxy/describe_task_status", type: "dynamic", decode: "catalogQuery", render: "catalogResult" },
  { method: "POST", path: "/v1/wand/asrproxy/async_query", type: "dynamic", decode: "catalogQuery", render: "catalogResult" },
  { method: "POST", path: "/v1/wand/wx-asr/async-query", type: "dynamic", decode: "catalogQuery", render: "catalogResult" },
);

const MAX_PROMPT_LENGTH = 8192;
const MAX_REFERENCE_IMAGES = 10;
const MAX_USAGE_TOKENS = 2147483647;
// Published maximum output usage across 1K/2K/4K for the 1.0 models. Pro
// additionally bills each reference image after the first three.
const MAX_OUTPUT_TOKENS = {
  "wand-vega-image-lite": 18000,
  "wand-vega-image-flash": 77500,
  "wand-vega-image-pro": 171000,
};

export const meta = {
  apiVersion: 1,
  key: "tencenttokenhub",
  name: "Tencent TokenHub",
  icon: "Tencent.Color",
  description: {
    en: "Tencent Cloud TokenHub native generation task routing",
    zh: "腾讯云 TokenHub 原生生成任务路由",
  },
  version: "1.2.0",
  author: { name: "new-api" },
  baseUrl: "https://tokenhub.tencentmaas.com",
  models: MODELS,
  fetchMode: "per_task",
  auth: { type: "api_key" },
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: { en: "Generation token unit price", zh: "生成 Token 单价" },
    },
  },
  usageExamples: [{ label: "16,200 tokens", facts: { tokens: 16200 } }],
  usageProfiles: [
    {
      models: VIDEO_SECONDS_MODELS,
      schema: {
        seconds: {
          type: "number",
          unit: "second",
          description: { en: "Video generation unit price", zh: "视频生成单价" },
        },
      },
      examples: [{ label: "720p · 5s", facts: { seconds: 5 } }],
    },
    {
      models: THREE_D_MODELS,
      schema: {
        generation_count: {
          type: "number",
          unit: "count",
          unitLabel: { en: "generation", zh: "次" },
          description: { en: "3D generation unit price", zh: "3D 生成单价" },
        },
      },
      examples: [{ label: "Standard generation", facts: { generation_count: 1 } }],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/v1/wand/vega-images/generations",
      type: "submit",
      decode: "vegaImage",
      render: "imageSubmitted",
    },
    {
      method: "GET",
      path: "/v1/wand/vega-images/tasks/:task_id",
      type: "query",
      render: "imageTask",
    },
    ...CATALOG_ROUTES,
  ],
  protocols: [{ name: "openai_image", models: VEGA_IMAGE_MODELS }],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonBody(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = ctx.body.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  return body;
}

function modelName(ctx) {
  const model = trimmed(ctx.upstreamModel || ctx.model || plainObject(ctx.requestBody).model);
  if (!VEGA_IMAGE_MODELS.includes(model)) throw new Error("unsupported Tencent TokenHub WAND-Vega image model");
  return model;
}

function catalogSpec(ctx) {
  const action = trimmed(ctx && ctx.action);
  const prefix = "catalog:";
  if (action.indexOf(prefix) !== 0) return null;
  return NATIVE_TASK_SPECS[action.slice(prefix.length)] || null;
}

function catalogAction(path) {
  const requestPath = String(path || "").replace(/\/$/, "");
  for (const action of Object.keys(NATIVE_TASK_SPECS)) {
    const spec = NATIVE_TASK_SPECS[action];
    if (requestPath === spec.path || requestPath.endsWith("/tencenttokenhub" + spec.path)) return action;
  }
  return "";
}

function catalogModel(ctx, spec) {
  const model = trimmed(ctx.upstreamModel || ctx.model || plainObject(ctx.requestBody).model);
  if (!spec || !spec.models.includes(model)) throw new Error("unsupported model for this Tencent TokenHub endpoint");
  return model;
}

function validateCatalogRequest(body, spec, model) {
  if (!spec.models.includes(model)) throw new Error("unsupported model for this Tencent TokenHub endpoint");
  for (const field of ["n", "count", "num_outputs"]) {
    if (body[field] === undefined || body[field] === null) continue;
    const count = Number(body[field]);
    if (!Number.isInteger(count) || count < 1 || count > 128) {
      throw new Error(field + " must be an integer between 1 and 128");
    }
  }
  if (body.series_amount !== undefined && body.series_amount !== null && body.series_amount !== "auto") {
    const seriesAmount = Number(body.series_amount);
    if (!Number.isInteger(seriesAmount) || seriesAmount < 1 || seriesAmount > 128) {
      throw new Error("series_amount must be auto or an integer between 1 and 128");
    }
  }
  for (const field of ["duration", "seconds", "video_length"]) {
    if (body[field] === undefined || body[field] === null) continue;
    const seconds = Number(body[field]);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) {
      throw new Error(field + " must be greater than 0 and at most 3600");
    }
  }
  if (VIDEO_SECONDS_MODELS.includes(model) && requestedSeconds(body) === 0) {
    throw new Error("duration is required for second-based billing models");
  }
}

function catalogTaskID(body) {
  const source = plainObject(body);
  const data = plainObject(source.data);
  const response = plainObject(source.Response || source.response);
  const result = plainObject(source.result);
  return trimmed(
    source.task_id || source.taskId || source.id || source.video_id ||
    data.task_id || data.taskId || data.id || data.video_id ||
    response.task_id || response.taskId || response.id || response.video_id ||
    result.task_id || result.taskId || result.id || result.video_id
  );
}

function catalogError(body) {
  const source = plainObject(body);
  const error = plainObject(source.error);
  if (trimmed(error.message)) return trimmed(error.message);
  const code = source.code === undefined ? source.err_code : source.code;
  if (code !== undefined && code !== null && code !== 0 && code !== "0" && code !== "OK" && code !== "Success") {
    return trimmed(source.message || source.msg || source.error_message) || "Tencent TokenHub error " + String(code);
  }
  return "";
}

function catalogStatus(body) {
  const source = plainObject(body);
  const data = plainObject(source.data);
  const response = plainObject(source.Response || source.response);
  const task = plainObject(source.task);
  let status = source.status;
  if (status === undefined) status = source.state;
  if (status === undefined) status = source.task_status;
  if (status === undefined) status = data.status;
  if (status === undefined) status = data.state;
  if (status === undefined) status = data.task_status;
  if (status === undefined) status = response.status;
  if (status === undefined) status = response.state;
  if (status === undefined) status = task.status;
  if (status === undefined && Array.isArray(source.data) && source.data.length) status = plainObject(source.data[0]).status;
  if (typeof status === "number") {
    if (status === 1) return "SUCCESS";
    if (status === 5) return "IN_PROGRESS";
    if (status === 6 || status === 7 || status === 8) return "FAILURE";
  }
  const normalized = trimmed(status).toLowerCase().replace(/[ -]/g, "_");
  if (["success", "succeed", "succeeded", "completed", "complete", "done", "finished"].includes(normalized)) return "SUCCESS";
  if (["failed", "fail", "failure", "cancelled", "canceled", "deleted", "error"].includes(normalized)) return "FAILURE";
  if (["running", "processing", "in_progress", "generating"].includes(normalized)) return "IN_PROGRESS";
  if (["created", "submitted", "queued", "queueing", "pending", "wait", "waiting"].includes(normalized)) return "QUEUED";
  return "UNKNOWN";
}

function catalogURLs(body) {
  const urls = [];
  const seen = {};
  function visit(value, key, depth) {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const url = trimmed(value);
      if (/^https?:\/\//i.test(url) && /(url|uri|image|video|audio|file|output|result|resource|data)s?$/i.test(key || "")) {
        if (!seen[url]) {
          urls.push(url);
          seen[url] = true;
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const childKey of Object.keys(value)) visit(value[childKey], childKey, depth + 1);
  }
  visit(body, "data", 0);
  return urls;
}

function catalogUsageTokens(body) {
  const source = plainObject(body);
  const candidates = [
    plainObject(source.usage).total_tokens,
    plainObject(source.usage).total_token,
    plainObject(source.token_usage).total_tokens,
    plainObject(source.tokenhub_usage).total_tokens,
    plainObject(plainObject(source.data).usage).total_tokens,
    plainObject(plainObject(source.Response || source.response).usage).total_tokens,
  ];
  for (const value of candidates) {
    const tokens = Number(value);
    if (Number.isInteger(tokens) && tokens > 0 && tokens <= MAX_USAGE_TOKENS) return tokens;
  }
  return 0;
}

function requestedSeconds(body) {
  const source = plainObject(body);
  const value = source.duration === undefined
    ? (source.seconds === undefined ? source.video_length : source.seconds)
    : source.duration;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) return 0;
  return seconds;
}

function normalizedInput(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("input must be an array");
  const normalized = [];
  let imageCount = 0;
  for (const item of input) {
    const message = plainObject(item);
    if (!Array.isArray(message.content)) throw new Error("input[].content must be an array");
    const content = [];
    for (const itemContent of message.content) {
      const part = plainObject(itemContent);
      if (trimmed(part.type) !== "input_image") throw new Error("input[].content[].type must be input_image");
      const imageURL = trimmed(part.image_url);
      if (!imageURL) throw new Error("input_image.image_url is required");
      imageCount += 1;
      if (imageCount > MAX_REFERENCE_IMAGES) throw new Error("at most 10 reference images are supported");
      content.push({ type: "input_image", image_url: imageURL });
    }
    normalized.push({ content: content });
  }
  return normalized;
}

function normalizedRequest(source, model) {
  const prompt = trimmed(source.prompt);
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("prompt must not exceed 8192 characters");
  const body = { model: model, prompt: prompt };
  const input = normalizedInput(source.input);
  if (input.length) body.input = input;
  const size = trimmed(source.size);
  if (size) {
    if (!/^\d+x\d+$/i.test(size)) throw new Error("size must use WIDTHxHEIGHT format");
    body.size = size;
  }
  return body;
}

function responseError(body) {
  const source = plainObject(body);
  const error = plainObject(source.error);
  return trimmed(error.message || source.message);
}

function outputImages(body) {
  const images = [];
  for (const item of Array.isArray(plainObject(body).data) ? body.data : []) {
    const url = trimmed(plainObject(item).url);
    if (url) images.push(url);
  }
  return images;
}

function nativeStatus(task) {
  const status = trimmed(task && task.status).toUpperCase();
  if (status === "SUCCESS") return "completed";
  if (status === "FAILURE") return "failed";
  if (status === "IN_PROGRESS") return "in_progress";
  return "queued";
}

function nativeTask(task) {
  const data = Object.assign({}, plainObject(task && task.data));
  data.task_id = trimmed(task && task.task_id);
  data.status = nativeStatus(task);
  if (!trimmed(data.request_id)) data.request_id = trimmed(plainObject(task && task.properties).request_id);
  if (data.status === "failed" && !data.error) {
    data.error = { message: trimmed(task && task.fail_reason) || "task failed" };
  }
  return data;
}

function authorizationHeader(ctx) {
  // api_key auth supplies a raw key; gateway chaining may already supply
  // the Bearer envelope. Neither form may be sent without its scheme.
  const key = trimmed(ctx.apiKey || ctx.authHeader);
  if (!key) throw new Error("TokenHub API key is required");
  return /^Bearer\s+/i.test(key) ? key : "Bearer " + key;
}

export function buildSubmitRequest(ctx) {
  const spec = catalogSpec(ctx);
  if (spec) {
    const body = Object.assign({}, plainObject(ctx.requestBody));
    const model = catalogModel(ctx, spec);
    validateCatalogRequest(body, spec, model);
    body.model = model;
    return {
      url: trimmed(ctx.baseUrl).replace(/\/$/, "") + spec.path,
      method: "POST",
      headers: {
        Authorization: authorizationHeader(ctx),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body,
    };
  }
  const body = normalizedRequest(plainObject(ctx.requestBody), modelName(ctx));
  return {
    url: trimmed(ctx.baseUrl).replace(/\/$/, "") + "/v1/wand/vega-images/generations",
    method: "POST",
    headers: {
      Authorization: authorizationHeader(ctx),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body,
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = plainObject(plainObject(response).body);
  const spec = catalogSpec(ctx);
  if (spec) {
    const error = catalogError(body);
    if (error) throw new Error(error);
    const taskID = spec.sync ? trimmed(ctx.publicTaskId || catalogTaskID(body) || body.request_id) : catalogTaskID(body);
    if (!taskID) throw new Error("Tencent TokenHub returned no task id");
    if (spec.sync) {
      return {
        taskId: taskID,
        taskData: body,
        immediate: { status: "SUCCESS", progress: "100%", url: catalogURLs(body)[0] || "" },
      };
    }
    return { taskId: taskID, taskData: body };
  }
  const error = responseError(body);
  if (error) throw new Error(error);
  const taskID = trimmed(body.task_id);
  if (!taskID) throw new Error("Tencent TokenHub returned no task id");
  return { taskId: taskID, taskData: body, state: { request_id: trimmed(body.request_id) } };
}

export function buildQueryRequest(ctx) {
  const taskID = trimmed(ctx.taskId);
  if (!taskID) throw new Error("task id is required");
  const spec = catalogSpec(ctx);
  if (spec) {
    if (!spec.queryPath) throw new Error("Tencent TokenHub task does not support polling");
    const headers = { Authorization: authorizationHeader(ctx), Accept: "application/json" };
    if (spec.queryMethod === "POST") {
      const body = {};
      body[spec.queryIdField || "task_id"] = taskID;
      if (spec.queryModel) body.model = catalogModel(ctx, spec);
      headers["Content-Type"] = "application/json";
      return {
        url: trimmed(ctx.baseUrl).replace(/\/$/, "") + spec.queryPath,
        method: "POST",
        headers: headers,
        body: body,
      };
    }
    return {
      url: trimmed(ctx.baseUrl).replace(/\/$/, "") + spec.queryPath.replace(":task_id", encodeURIComponent(taskID)),
      method: "GET",
      headers: headers,
    };
  }
  return {
    url: trimmed(ctx.baseUrl).replace(/\/$/, "") + "/v1/wand/vega-images/tasks/" + encodeURIComponent(taskID),
    method: "GET",
    headers: { Authorization: authorizationHeader(ctx), Accept: "application/json" },
  };
}

export function parseTaskResult(ctx, body) {
  const source = plainObject(body);
  const spec = catalogSpec(ctx);
  if (spec) {
    const error = catalogError(source);
    const status = catalogStatus(source);
    if (status === "SUCCESS" || (status === "UNKNOWN" && catalogURLs(source).length)) {
      const urls = catalogURLs(source);
      const result = { status: "SUCCESS", progress: "100%", url: urls[0] || "" };
      if (spec.artifact === "image") result.imageUrls = urls;
      if (spec.artifact === "video") result.videoUrls = urls;
      if (spec.artifact === "audio") result.audioUrls = urls;
      return result;
    }
    if (status === "FAILURE" || error) {
      return { status: "FAILURE", progress: "100%", reason: error || trimmed(source.message || source.msg) || "Tencent TokenHub task failed" };
    }
    if (status === "IN_PROGRESS") return { status: "IN_PROGRESS", progress: "50%" };
    if (status === "QUEUED") return { status: "QUEUED", progress: "10%" };
    return { status: "UNKNOWN", reason: "unrecognized Tencent TokenHub status" };
  }
  const error = responseError(source);
  const status = trimmed(source.status).toLowerCase();
  if (status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "in_progress") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "completed") {
    const images = outputImages(source);
    if (!images.length) throw new Error("Tencent TokenHub reported completed without an output url");
    return { status: "SUCCESS", progress: "100%", url: images[0], imageUrls: images };
  }
  if (status === "failed" || status === "cancelled" || status === "incomplete") {
    return { status: "FAILURE", progress: "100%", reason: error || "Tencent TokenHub task " + status };
  }
  if (error) return { status: "FAILURE", progress: "100%", reason: error };
  return { status: "UNKNOWN", reason: "unrecognized Tencent TokenHub status: " + trimmed(source.status) };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const spec = catalogSpec(task);
  if (spec) {
    return catalogURLs(task.data).map(function (_url, index) {
      const artifact = { key: spec.artifact + "-" + (index + 1), type: spec.artifact };
      if (spec.artifact === "video") artifact.mimeType = "video/mp4";
      return artifact;
    });
  }
  return outputImages(task.data).map(function (_url, index) {
    return { key: "image-" + (index + 1), type: "image" };
  });
}

export function buildContentRequest(ctx) {
  const spec = catalogSpec(ctx);
  if (spec) {
    const pattern = new RegExp("^" + spec.artifact + "-(\\d+)$");
    const catalogMatch = pattern.exec(String(ctx.artifactKey || ""));
    if (!catalogMatch) throw new Error("artifact_not_found");
    const urls = catalogURLs(ctx.data);
    const catalogIndex = Number(catalogMatch[1]) - 1;
    if (catalogIndex < 0 || catalogIndex >= urls.length) throw new Error("artifact_not_found");
    return { url: urls[catalogIndex], method: ctx.clientRequest.method, credentialless: true };
  }
  const match = /^image-(\d+)$/.exec(String(ctx.artifactKey || ""));
  if (!match) throw new Error("artifact_not_found");
  const images = outputImages(ctx.data);
  const index = Number(match[1]) - 1;
  if (index < 0 || index >= images.length) throw new Error("artifact_not_found");
  return { url: images[index], method: ctx.clientRequest.method, credentialless: true };
}

// Reserve the published maximum for 1.0 models, then settle against the exact
// provider usage. TokenHub currently publishes no 1.5-Pro token ceiling, so
// that model starts at zero and is charged from total_tokens on completion.
export function extractUsage(ctx) {
  const spec = catalogSpec(ctx);
  if (spec) {
    const model = catalogModel(ctx, spec);
    validateCatalogRequest(plainObject(ctx.requestBody), spec, model);
    if (THREE_D_MODELS.includes(model)) return { generation_count: 1 };
    if (VIDEO_SECONDS_MODELS.includes(model)) return { seconds: requestedSeconds(ctx.requestBody) };
    return { tokens: 0 };
  }
  const model = modelName(ctx);
  let tokens = MAX_OUTPUT_TOKENS[model] || 0;
  if (model === "wand-vega-image-pro") {
    const references = normalizedInput(plainObject(ctx.requestBody).input).reduce(function (count, item) {
      return count + item.content.length;
    }, 0);
    tokens += Math.max(0, references - 3) * 10000;
  }
  return { tokens: tokens };
}

export function extractUsageOnComplete(ctx, taskResult, body) {
  const spec = catalogSpec(ctx);
  if (spec) {
    const model = catalogModel(ctx, spec);
    if (!taskResult || taskResult.status !== "SUCCESS") {
      if (THREE_D_MODELS.includes(model)) return { generation_count: 0 };
      if (VIDEO_SECONDS_MODELS.includes(model)) return { seconds: 0 };
      return { tokens: 0 };
    }
    if (THREE_D_MODELS.includes(model)) return { generation_count: 1 };
    if (VIDEO_SECONDS_MODELS.includes(model)) {
      const seconds = requestedSeconds(body);
      return seconds > 0 ? { seconds: seconds } : {};
    }
    const tokens = catalogUsageTokens(body);
    return tokens > 0 ? { tokens: tokens } : null;
  }
  if (!taskResult || taskResult.status !== "SUCCESS") return { tokens: 0 };
  const tokens = Number(plainObject(plainObject(body).usage).total_tokens);
  if (!Number.isInteger(tokens) || tokens <= 0 || tokens > MAX_USAGE_TOKENS) return null;
  return { tokens: tokens };
}

export const native = {
  catalogTask: function (ctx) {
    const body = jsonBody(ctx);
    const action = catalogAction(ctx.path);
    const spec = NATIVE_TASK_SPECS[action];
    if (!spec) throw new Error("unsupported Tencent TokenHub endpoint");
    const model = trimmed(body.model);
    validateCatalogRequest(body, spec, model);
    return {
      kind: "submit",
      model: model,
      action: "catalog:" + action,
      requestBody: body,
    };
  },
  catalogQuery: function (ctx) {
    const body = jsonBody(ctx);
    const taskID = trimmed(body.task_id || body.taskId || body.id);
    if (!taskID) throw new Error("task id is required");
    return { kind: "query", taskIds: [taskID] };
  },
  catalogResult: function (_ctx, task) {
    return plainObject(task && task.data);
  },
  vegaImage: function (ctx) {
    const body = jsonBody(ctx);
    const model = trimmed(body.model);
    normalizedRequest(body, modelName({ model: model, requestBody: body }));
    return {
      kind: "submit",
      model: model,
      action: normalizedInput(body.input).length ? "image_to_image" : "text_to_image",
      requestBody: body,
    };
  },
  imageSubmitted: function (ctx, task) {
    const data = plainObject(task && task.data);
    return { task_id: trimmed(task && task.task_id), request_id: trimmed(data.request_id) };
  },
  imageTask: function (ctx, task) {
    return nativeTask(task);
  },
  error: function (ctx, error) {
    return {
      error: {
        type: "invalid_request_error",
        code: String((error && error.code) || "invalid_request"),
        message: trimmed(error && error.message) || "request failed",
      },
      request_id: trimmed(error && error.requestId),
    };
  },
};

export const protocols = {
  openai_image: {
    decodeRequest: function (ctx) {
      const source = jsonBody(ctx);
      if (source.n !== undefined && Number(source.n) !== 1) throw new Error("n must be 1 for Tencent TokenHub WAND-Vega");
      if (source.mask !== undefined) throw new Error("mask is not supported by Tencent TokenHub WAND-Vega");
      const images = []
        .concat(source.image === undefined ? [] : source.image)
        .concat(source.images === undefined ? [] : source.images);
      const input = images.length
        ? [{ content: images.map(function (image) { return { type: "input_image", image_url: trimmed(image) }; }) }]
        : [];
      const requestBody = { prompt: source.prompt, size: source.size, input: input };
      normalizedRequest(requestBody, modelName({ model: ctx.model, requestBody: requestBody }));
      return {
        kind: "submit",
        model: ctx.model,
        action: images.length ? "image_to_image" : "text_to_image",
        requestBody: requestBody,
      };
    },
    render: function (ctx, task) {
      return {
        created: task.created_at,
        data: outputImages(task.data).map(function (url) { return { url: url }; }),
      };
    },
  },
};
