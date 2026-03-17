const fs = require("fs");
const FormData = require("form-data");

const { AppError } = require("../utils/errors");
const { requestJson } = require("../utils/http");
const { parseJsonField } = require("../utils/parsing");
const { validateTargetUrl } = require("../utils/urlValidator");

function getOutputFormats(config) {
  const formats = config.outputFormats || [];

  if (Array.isArray(formats) && formats.length > 0) {
    return formats;
  }

  return ["text", "html", "markdown"];
}

async function runUpstageDocumentParse({ file, fileMetadata, config }) {
  const url = config.url;

  if (!url) {
    throw new AppError("Upstage DP 호출 URL이 필요합니다.", 400);
  }

  await validateTargetUrl(url);

  const headers = parseJsonField(config.headersJson, {});
  const timeoutMs = Number(config.timeoutMs || 300000);
  const retryCount = Number(config.retryCount || 1);
  const form = new FormData();

  form.append("document", fs.createReadStream(file.path), {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  if (config.ocrMode) {
    form.append("ocr", String(config.ocrMode));
  }

  form.append("coordinates", String(config.coordinates ?? true));

  getOutputFormats(config).forEach((format) => {
    form.append("output_formats", format);
  });

  if (config.model) {
    form.append("model", String(config.model));
  }

  if (typeof config.base64Encoding !== "undefined") {
    form.append("base64_encoding", String(config.base64Encoding));
  }

  const response = await requestJson({
    method: "POST",
    url,
    data: form,
    headers: {
      ...form.getHeaders(),
      ...headers,
    },
    timeoutMs,
    retryCount,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const raw = response.data;

  return {
    stage: "upstage",
    statusCode: response.status,
    request: {
      url,
      options: {
        ocrMode: config.ocrMode || "auto",
        coordinates: Boolean(config.coordinates ?? true),
        outputFormats: getOutputFormats(config),
        model: config.model || "",
        base64Encoding: Boolean(config.base64Encoding ?? false),
        timeoutMs,
        retryCount,
      },
    },
    content: {
      text: raw?.content?.text || "",
      html: raw?.content?.html || "",
      markdown: raw?.content?.markdown || "",
    },
    elements: raw?.elements || [],
    usage: raw?.usage || {},
    pageCount: raw?.usage?.pages || fileMetadata.pageCount || null,
    raw,
  };
}

async function checkEndpoints(payload) {
  const url = payload.url;

  if (!url) {
    throw new AppError("엔드포인트 확인 URL이 필요합니다.", 400);
  }

  await validateTargetUrl(url);

  const response = await requestJson({
    method: "GET",
    url,
    headers: parseJsonField(payload.headersJson, {}),
    timeoutMs: Number(payload.timeoutMs || 30000),
    retryCount: Number(payload.retryCount || 1),
  });

  return {
    statusCode: response.status,
    raw: response.data,
  };
}

async function registerLicense(payload) {
  const url = payload.url;

  if (!url) {
    throw new AppError("라이선스 등록 URL이 필요합니다.", 400);
  }

  await validateTargetUrl(url);

  const body = parseJsonField(payload.bodyJson, {});
  const licenseKey = payload.licenseKey || payload.license_key || "";
  const response = await requestJson({
    method: "POST",
    url,
    headers: {
      "Content-Type": "application/json",
      ...parseJsonField(payload.headersJson, {}),
    },
    data: {
      ...body,
      ...(licenseKey
        ? {
            licenseKey,
            license_key: licenseKey,
          }
        : {}),
    },
    timeoutMs: Number(payload.timeoutMs || 30000),
    retryCount: Number(payload.retryCount || 1),
  });

  return {
    statusCode: response.status,
    raw: response.data,
  };
}

module.exports = {
  runUpstageDocumentParse,
  checkEndpoints,
  registerLicense,
};
