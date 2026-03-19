const axios = require("axios");

const { env } = require("./env");
const { AppError } = require("./errors");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function getUpstreamStatusCode(status) {
  return status >= 400 && status <= 599 ? status : 502;
}

function isTimeoutError(error) {
  return error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "");
}

function extractNetworkField(error, field) {
  return error?.[field] ?? error?.cause?.[field] ?? null;
}

function buildHttpHint(url, status) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "/";

    if ([404, 405].includes(status) && ["/", "/v1", "/v1/"].includes(path)) {
      return "This app sends Chat Completions requests directly. For OpenAI-compatible servers, use the full /v1/chat/completions endpoint instead of only /v1.";
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function buildNetworkHint(url, error) {
  const code = extractNetworkField(error, "code");
  const message = error?.message || error?.cause?.message || "";

  try {
    const parsed = new URL(url);
    const hostname = (parsed.hostname || "").toLowerCase();

    if (code === "ECONNREFUSED" && ["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      return "If the backend runs in Docker, localhost points to the container itself. Use host.docker.internal or a reachable internal hostname instead.";
    }
  } catch (_error) {
    return null;
  }

  if (code === "ENOTFOUND") {
    return "DNS lookup failed. Verify that the hostname is resolvable from the backend runtime.";
  }

  if (code === "ECONNREFUSED") {
    return "The target host refused the connection. Verify that the service is listening on the configured host and port.";
  }

  if (code === "ECONNRESET") {
    return "The upstream service reset the connection. Check the upstream logs and any request size or proxy limits.";
  }

  if (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    /self signed certificate/i.test(message)
  ) {
    return "The upstream TLS certificate is not trusted by Node.js. Use a trusted certificate or add explicit TLS handling.";
  }

  return null;
}

async function requestJson({
  method,
  url,
  headers = {},
  data,
  timeoutMs = env.defaultTimeoutMs,
  retryCount = env.defaultRetryCount,
  maxBodyLength,
  maxContentLength,
}) {
  const attempts = Math.max(1, Number(retryCount || 1));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios({
        method,
        url,
        headers,
        data,
        timeout: timeoutMs,
        responseType: "json",
        validateStatus: () => true,
        maxBodyLength,
        maxContentLength,
      });

      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      lastError = new AppError(
        `Remote service returned HTTP ${response.status}.`,
        getUpstreamStatusCode(response.status),
        {
          requestUrl: url,
          remoteStatus: response.status,
          remoteData: response.data,
          hint: buildHttpHint(url, response.status),
        }
      );

      if (attempt < attempts && isRetryableStatus(response.status)) {
        await sleep(500 * attempt);
        continue;
      }

      throw lastError;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const statusCode = isTimeoutError(error) ? 504 : 502;
      const message = isTimeoutError(error)
        ? "Remote service request timed out."
        : "Failed to call remote service.";

      lastError = new AppError(message, statusCode, {
        requestUrl: url,
        message: error.message,
        code: extractNetworkField(error, "code"),
        errno: extractNetworkField(error, "errno"),
        syscall: extractNetworkField(error, "syscall"),
        address: extractNetworkField(error, "address") || extractNetworkField(error, "hostname"),
        port: extractNetworkField(error, "port"),
        hint: buildNetworkHint(url, error),
      });

      if (attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw lastError || new AppError("Unexpected network error.", 502);
}

async function requestJsonAllowAnyStatus({
  method,
  url,
  headers = {},
  data,
  timeoutMs = env.defaultTimeoutMs,
  maxBodyLength,
  maxContentLength,
}) {
  try {
    return await axios({
      method,
      url,
      headers,
      data,
      timeout: timeoutMs,
      responseType: "json",
      validateStatus: () => true,
      maxBodyLength,
      maxContentLength,
    });
  } catch (error) {
    const statusCode = isTimeoutError(error) ? 504 : 502;
    const message = isTimeoutError(error)
      ? "Remote service request timed out."
      : "Failed to call remote service.";

    throw new AppError(message, statusCode, {
      requestUrl: url,
      message: error.message,
      code: extractNetworkField(error, "code"),
      errno: extractNetworkField(error, "errno"),
      syscall: extractNetworkField(error, "syscall"),
      address: extractNetworkField(error, "address") || extractNetworkField(error, "hostname"),
      port: extractNetworkField(error, "port"),
      hint: buildNetworkHint(url, error),
    });
  }
}

module.exports = {
  requestJson,
  requestJsonAllowAnyStatus,
};
