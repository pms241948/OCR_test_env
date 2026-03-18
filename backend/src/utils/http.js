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
          remoteStatus: response.status,
          remoteData: response.data,
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
        message: error.message,
      });

      if (attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw lastError || new AppError("Unexpected network error.", 502);
}

module.exports = {
  requestJson,
};
