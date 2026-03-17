const { AppError } = require("../utils/errors");
const { requestJson } = require("../utils/http");
const { parseJsonField } = require("../utils/parsing");
const { buildPostprocessPrompt, extractAssistantText } = require("../utils/prompt");
const { validateTargetUrl } = require("../utils/urlValidator");

async function runPostprocessLlm({
  config,
  fileMetadata,
  upstageResult,
  visionResult,
}) {
  const url = config.url;

  if (!url) {
    throw new AppError("후처리 LLM 호출 URL이 필요합니다.", 400);
  }

  if (!config.model) {
    throw new AppError("후처리 LLM 모델명이 필요합니다.", 400);
  }

  await validateTargetUrl(url);

  const timeoutMs = Number(config.timeoutMs || 300000);
  const retryCount = Number(config.retryCount || 1);
  const extraHeaders = parseJsonField(config.headersJson, {});
  const extraBody = parseJsonField(config.extraBodyJson, {});

  const payload = {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          config.systemPrompt ||
          "You reconcile multiple OCR outputs into a clean final text.",
      },
      {
        role: "user",
        content: buildPostprocessPrompt({
          fileMetadata,
          config,
          upstageResult,
          visionResult,
        }),
      },
    ],
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
    },
    usedPrompt: {
      systemPrompt:
        config.systemPrompt ||
        "You reconcile multiple OCR outputs into a clean final text.",
      userPrompt: config.userPrompt || "",
      compiledPrompt: payload.messages[1].content,
    },
    usedReferenceText: config.referenceEnabled ? config.referenceText || "" : "",
    raw: response.data,
    text: extractAssistantText(response.data),
  };
}

module.exports = {
  runPostprocessLlm,
};
