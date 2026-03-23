const JSON_STRING_FIELDS = new Set(["headersJson", "extraBodyJson", "licenseBodyJson"]);
const SENSITIVE_CANONICAL_KEYS = new Set([
  "apikey",
  "xapikey",
  "authorization",
  "proxyauthorization",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearer",
  "clientsecret",
  "licensekey",
  "password",
  "secret",
]);

function canonicalizeKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key) {
  const canonical = canonicalizeKey(key);

  if (SENSITIVE_CANONICAL_KEYS.has(canonical)) {
    return true;
  }

  return /(^|[^a-z0-9])(token|secret|password)([^a-z0-9]|$)/i.test(String(key || ""));
}

function sanitizeJsonString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.stringify(sanitizeConfigForStorage(JSON.parse(value)));
  } catch (_error) {
    return value;
  }
}

function sanitizeConfigForStorage(input) {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeConfigForStorage(item));
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  return Object.entries(input).reduce((accumulator, [key, value]) => {
    if (isSensitiveKey(key)) {
      accumulator[key] = "";
      return accumulator;
    }

    if (JSON_STRING_FIELDS.has(key)) {
      accumulator[key] = sanitizeJsonString(value);
      return accumulator;
    }

    accumulator[key] = sanitizeConfigForStorage(value);
    return accumulator;
  }, {});
}

module.exports = {
  sanitizeConfigForStorage,
};
