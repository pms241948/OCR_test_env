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
        `원격 서비스가 ${response.status} 응답을 반환했습니다.`,
        502,
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

      lastError = new AppError("원격 서비스 호출에 실패했습니다.", 502, {
        message: error.message,
      });

      if (attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw lastError || new AppError("알 수 없는 네트워크 오류가 발생했습니다.", 502);
}

module.exports = {
  requestJson,
};
