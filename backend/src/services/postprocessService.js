const { AppError } = require("../utils/errors");
const { requestJson, requestJsonAllowAnyStatus } = require("../utils/http");
const { parseJsonField } = require("../utils/parsing");
const {
  buildPostprocessPrompt,
  buildPostprocessSystemPrompt,
  extractAssistantText,
} = require("../utils/prompt");
const { normalizeOpenAiChatUrl, validateTargetUrl } = require("../utils/urlValidator");

function resolvePostprocessSourceSelection(config = {}) {
  return {
    opendataloader: config.includeOpendataloader === true,
    upstage: config.includeUpstage !== false,
    vision: config.includeVision !== false,
  };
}

function validateSelectedSources(sourceSelection, sources) {
  const enabledSources = Object.entries(sourceSelection)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  if (!enabledSources.length) {
    throw new AppError("At least one OCR result must be selected for postprocess.", 400);
  }

  const missingSources = enabledSources.filter((key) => !sources[key]);
  if (missingSources.length > 0) {
    throw new AppError("Selected OCR results are missing for postprocess.", 400, {
      sources: missingSources,
    });
  }
}

async function runPostprocessLlm({
  config,
  fileMetadata,
  opendataloaderResult,
  upstageResult,
  visionResult,
}) {
  const url = normalizeOpenAiChatUrl(config.url);
  const useHardcodedPrompts = config.useHardcodedPrompts !== false;
  const sourceSelection = resolvePostprocessSourceSelection(config);

  if (!url) {
    throw new AppError("?꾩쿂由?LLM ?몄텧 URL???꾩슂?⑸땲??", 400);
  }

  if (!config.model) {
    throw new AppError("?꾩쿂由?LLM 紐⑤뜽紐낆씠 ?꾩슂?⑸땲??", 400);
  }

  validateSelectedSources(sourceSelection, {
    opendataloader: opendataloaderResult,
    upstage: upstageResult,
    vision: visionResult,
  });

  await validateTargetUrl(url);

  const timeoutMs = Number(config.timeoutMs || 300000);
  const retryCount = Number(config.retryCount || 1);
  const extraHeaders = parseJsonField(config.headersJson, {});
  const extraBody = parseJsonField(config.extraBodyJson, {});
  const effectiveSystemPrompt = buildPostprocessSystemPrompt(
    config.systemPrompt,
    useHardcodedPrompts
  );
  const compiledPrompt = buildPostprocessPrompt({
    fileMetadata,
    config,
    opendataloaderResult,
    upstageResult,
    visionResult,
    sourceSelection,
    useHardcodedPrompts,
  });
  const messages = [];

  if (effectiveSystemPrompt) {
    messages.push({
      role: "system",
      content: effectiveSystemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: compiledPrompt,
  });

  const payload = {
    model: config.model,
    messages,
    temperature: Number(config.temperature ?? 0.1),
    max_tokens: Number(config.maxTokens || 4000),
    top_p: Number(config.topP ?? 1),
    ...extraBody,
  };

  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await requestJson({
    method: "POST",
    url,
    headers,
    data: payload,
    timeoutMs,
    retryCount,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return {
    stage: "postprocess",
    statusCode: response.status,
    request: {
      url,
      payload,
      sourceSelection,
    },
    usedPrompt: {
      systemPrompt: effectiveSystemPrompt,
      userPrompt: config.userPrompt || "",
      compiledPrompt,
    },
    usedReferenceText: config.referenceEnabled ? config.referenceText || "" : "",
    raw: response.data,
    text: extractAssistantText(response.data),
  };
}

async function testPostprocessConnection(config) {
  const url = normalizeOpenAiChatUrl(config.url);

  if (!url) {
    throw new AppError("Postprocess connection test URL is required.", 400);
  }

  if (!config.model) {
    throw new AppError("Postprocess connection test model is required.", 400);
  }

  await validateTargetUrl(url);

  const timeoutMs = Number(config.timeoutMs || 30000);
  const extraHeaders = parseJsonField(config.headersJson, {});
  const extraBody = parseJsonField(config.extraBodyJson, {});
  const payload = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: "You are a connection test. Reply with OK only.",
      },
      {
        role: "user",
        content: "OK",
      },
    ],
    temperature: 0,
    max_tokens: 8,
    top_p: 1,
    ...extraBody,
  };
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await requestJsonAllowAnyStatus({
    method: "POST",
    url,
    headers,
    data: payload,
    timeoutMs,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return {
    stage: "postprocess_connection",
    ok: response.status >= 200 && response.status < 300,
    reachable: true,
    statusCode: response.status,
    request: {
      url,
      payload,
      note: "Connection check sends a minimal chat request and does not run postprocess reconciliation.",
    },
    raw: response.data,
    text: extractAssistantText(response.data),
  };
}

module.exports = {
  resolvePostprocessSourceSelection,
  runPostprocessLlm,
  testPostprocessConnection,
};
