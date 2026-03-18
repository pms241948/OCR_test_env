function sanitizeConfigForStorage(input) {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeConfigForStorage(item));
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  return Object.entries(input).reduce((accumulator, [key, value]) => {
    if (key === "apiKey") {
      accumulator[key] = "";
      return accumulator;
    }

    accumulator[key] = sanitizeConfigForStorage(value);
    return accumulator;
  }, {});
}

module.exports = {
  sanitizeConfigForStorage,
};
