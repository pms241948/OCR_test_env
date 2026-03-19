const dns = require("dns").promises;
const net = require("net");

const { env } = require("./env");
const { AppError } = require("./errors");

function isPrivateIpv4(ip) {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("127.") ||
    ip.startsWith("169.254.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function isPrivateIpv6(ip) {
  return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    return isPrivateIpv4(address);
  }

  if (net.isIPv6(address)) {
    return isPrivateIpv6(address.toLowerCase());
  }

  return false;
}

async function validateTargetUrl(input) {
  let parsed;

  try {
    parsed = new URL(input);
  } catch (_error) {
    throw new AppError("유효한 URL 형식이 아닙니다.", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError("http 또는 https URL만 허용됩니다.", 400);
  }

  if (parsed.username || parsed.password) {
    throw new AppError("인증 정보가 포함된 URL은 허용되지 않습니다.", 400);
  }

  if (env.allowPrivateUrls) {
    return parsed.toString();
  }

  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".local")) {
    throw new AppError("로컬 주소는 허용되지 않습니다.", 400);
  }

  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) {
    throw new AppError("사설 IP 주소는 허용되지 않습니다.", 400);
  }

  try {
    const lookups = await dns.lookup(parsed.hostname, { all: true });

    if (lookups.some((item) => isPrivateAddress(item.address))) {
      throw new AppError("사설 네트워크 주소로 해석되는 URL은 허용되지 않습니다.", 400);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("대상 URL의 DNS 해석에 실패했습니다.", 400, {
      message: error.message,
    });
  }

  return parsed.toString();
}

function normalizeOpenAiChatUrl(input) {
  let parsed;

  try {
    parsed = new URL(input);
  } catch (_error) {
    return input;
  }

  const path = parsed.pathname || "/";

  if (path === "/" || path === "") {
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  if (path === "/v1" || path === "/v1/") {
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  return parsed.toString();
}

module.exports = {
  normalizeOpenAiChatUrl,
  validateTargetUrl,
};
