function stringifyRange(range) {
  return JSON.stringify(range, null, 2);
}

function buildVisionPrompt({ fileMetadata, config, range }) {
  const lines = [
    config.userPrompt || "Extract OCR text from the supplied document image(s).",
    "",
    "Document metadata:",
    `- File name: ${fileMetadata.fileName}`,
    `- MIME type: ${fileMetadata.mimeType}`,
    `- Page count: ${fileMetadata.pageCount || 1}`,
    "",
    "Range configuration:",
    stringifyRange(range),
  ];

  if (config.extractionRules) {
    lines.push("", "Extraction rules:", config.extractionRules);
  }

  if (config.referenceEnabled && config.referenceText) {
    lines.push("", "Reference text for style and terminology:", config.referenceText);
  }

  lines.push(
    "",
    "Output requirements:",
    "- Preserve line breaks when they matter.",
    "- Preserve table-like structure as text where possible.",
    "- Prioritize digit and symbol fidelity.",
    "- Use [UNCLEAR] when a character cannot be determined."
  );

  return lines.join("\n");
}

function buildPostprocessPrompt({
  fileMetadata,
  config,
  upstageResult,
  visionResult,
}) {
  const lines = [
    config.userPrompt ||
      "Compare the OCR outputs, reconcile differences, and return the best final text.",
    "",
    "Document metadata:",
    `- File name: ${fileMetadata.fileName || ""}`,
    `- MIME type: ${fileMetadata.mimeType || ""}`,
    `- Page count: ${fileMetadata.pageCount || ""}`,
    "",
    "Vision range:",
    JSON.stringify(visionResult?.range || {}, null, 2),
    "",
    "Upstage OCR result:",
    upstageResult?.content?.markdown ||
      upstageResult?.content?.text ||
      upstageResult?.text ||
      "",
    "",
    "Vision OCR result:",
    visionResult?.text || "",
  ];

  if (config.referenceEnabled && config.referenceText) {
    lines.push("", "Reference answer/style guide:", config.referenceText);
  }

  lines.push(
    "",
    "Tasks:",
    "- Resolve conflicts between the two OCR outputs.",
    "- Correct obvious OCR mistakes.",
    "- Normalize formatting, list markers, and line breaks.",
    "- Reconstruct tables or item structures in readable text.",
    "- Reflect the reference answer style when provided.",
    "",
    "Return the refined final text only unless the user prompt explicitly asks for commentary."
  );

  return lines.join("\n");
}

function extractAssistantText(responseData) {
  if (!responseData) {
    return "";
  }

  if (typeof responseData.output_text === "string") {
    return responseData.output_text;
  }

  const message = responseData?.choices?.[0]?.message?.content;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text || "";
        }
        return "";
      })
      .join("\n");
  }

  return JSON.stringify(responseData, null, 2);
}

module.exports = {
  buildVisionPrompt,
  buildPostprocessPrompt,
  extractAssistantText,
};
