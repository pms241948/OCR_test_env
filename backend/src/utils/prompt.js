const OCR_TEXT_START_TAG = "<ocr_text>";
const OCR_TEXT_END_TAG = "</ocr_text>";

function stringifyRange(range) {
  return JSON.stringify(range, null, 2);
}

function joinPromptSegments(segments) {
  return segments
    .map((segment) => (typeof segment === "string" ? segment.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function buildVisionSystemPrompt(systemPrompt, useHardcodedPrompts = true) {
  if (!useHardcodedPrompts) {
    return systemPrompt || "";
  }

  const basePrompt =
    systemPrompt || "You extract OCR text from document images with high fidelity.";

  return [
    basePrompt,
    "",
    "Hard output rules:",
    "- Do not describe the image.",
    "- Do not explain your reasoning or intermediate steps.",
    "- Do not include introductions, summaries, bullet lists, or markdown fences.",
    `- Return exactly one ${OCR_TEXT_START_TAG}...${OCR_TEXT_END_TAG} block.`,
    "- Put only the extracted OCR text inside that block.",
  ].join("\n");
}

function buildVisionPrompt({ fileMetadata, config, range, useHardcodedPrompts = true }) {
  if (!useHardcodedPrompts) {
    return joinPromptSegments([
      config.userPrompt,
      config.extractionRules,
      config.referenceEnabled ? config.referenceText : "",
    ]);
  }

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
    "- Use [UNCLEAR] when a character cannot be determined.",
    "",
    "Response format:",
    `- Start with ${OCR_TEXT_START_TAG}`,
    `- End with ${OCR_TEXT_END_TAG}`,
    "- Do not write anything before or after those tags.",
    "- Do not include explanations, analysis, or commentary.",
  );

  return lines.join("\n");
}

function buildPostprocessPrompt({
  fileMetadata,
  config,
  opendataloaderResult,
  upstageResult,
  visionResult,
  sourceSelection,
  useHardcodedPrompts = true,
}) {
  const selectedSources = sourceSelection || {
    opendataloader: false,
    upstage: true,
    vision: true,
  };
  const opendataloaderText =
    opendataloaderResult?.content?.markdown ||
    opendataloaderResult?.content?.text ||
    opendataloaderResult?.text ||
    "";
  const upstageText =
    upstageResult?.content?.markdown ||
    upstageResult?.content?.text ||
    upstageResult?.text ||
    "";
  const visionText = visionResult?.text || "";
  const payload = {
    user_prompt: config.userPrompt || "",
    source_selection: selectedSources,
    reference_text: config.referenceEnabled ? config.referenceText || "" : "",
  };

  if (selectedSources.opendataloader) {
    payload.opendataloader_ocr = opendataloaderText;
  }

  if (selectedSources.upstage) {
    payload.upstage_ocr = upstageText;
  }

  if (selectedSources.vision) {
    payload.vision_ocr = visionText;
    payload.vision_range = visionResult?.range || {};
  }

  if (!useHardcodedPrompts) {
    return JSON.stringify(payload, null, 2);
  }

  const lines = [
    config.userPrompt ||
      "Compare the selected OCR outputs, reconcile differences, and return the best final text.",
    "",
    "Document metadata:",
    `- File name: ${fileMetadata.fileName || ""}`,
    `- MIME type: ${fileMetadata.mimeType || ""}`,
    `- Page count: ${fileMetadata.pageCount || ""}`,
    "",
    "Selected OCR inputs:",
    JSON.stringify(selectedSources, null, 2),
  ];

  if (selectedSources.opendataloader) {
    lines.push("", "OpenDataLoader PDF result:", opendataloaderText);
  }

  if (selectedSources.upstage) {
    lines.push("", "Upstage OCR result:", upstageText);
  }

  if (selectedSources.vision) {
    lines.push("", "Vision range:", JSON.stringify(visionResult?.range || {}, null, 2));
    lines.push("", "Vision OCR result:", visionText);
  }

  if (config.referenceEnabled && config.referenceText) {
    lines.push("", "Reference answer/style guide:", config.referenceText);
  }

  lines.push(
    "",
    "Tasks:",
    "- Resolve conflicts between the selected OCR outputs when multiple sources are provided.",
    "- Correct obvious OCR mistakes.",
    "- Normalize formatting, list markers, and line breaks.",
    "- Reconstruct tables or item structures in readable text.",
    "- Reflect the reference answer style when provided.",
    "",
    "Return the refined final text only unless the user prompt explicitly asks for commentary."
  );

  return lines.join("\n");
}

function buildPostprocessSystemPrompt(systemPrompt, useHardcodedPrompts = true) {
  if (!useHardcodedPrompts) {
    return systemPrompt || "";
  }

  const basePrompt =
    systemPrompt || "You reconcile multiple OCR outputs into a clean final text.";

  return [
    basePrompt,
    "",
    "Hard output rules:",
    "- Return the final merged text only.",
    "- Do not explain your reasoning.",
    "- Do not add commentary unless the user explicitly asked for it.",
  ].join("\n");
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

function stripThinkBlocks(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

function extractTaggedText(text, startTag, endTag) {
  const startIndex = text.indexOf(startTag);
  const endIndex = text.indexOf(endTag);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  return text.slice(startIndex + startTag.length, endIndex).trim();
}

function looksLikeReasoningLine(line) {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  return [
    /^based on\b/i,
    /^i (?:will|need|can|should|am going to|must|have to)\b/i,
    /^let'?s\b/i,
    /^wait\b/i,
    /^\d+\.\s/,
    /^\*\s/,
    /^-\s/,
    /^header section\b/i,
    /^table structure\b/i,
    /^left column\b/i,
    /^right column\b/i,
    /^refining the output\b/i,
    /^row \d+:/i,
    /^actually\b/i,
  ].some((pattern) => pattern.test(trimmed));
}

function stripLeadingReasoning(text) {
  const lines = String(text || "").split(/\r?\n/);
  let index = 0;

  while (index < lines.length && looksLikeReasoningLine(lines[index])) {
    index += 1;
  }

  const candidate = lines.slice(index).join("\n").trim();
  return candidate || String(text || "").trim();
}

function extractVisionText(responseData) {
  const rawText = stripThinkBlocks(extractAssistantText(responseData));
  const taggedText = extractTaggedText(rawText, OCR_TEXT_START_TAG, OCR_TEXT_END_TAG);

  if (taggedText !== null) {
    return taggedText;
  }

  return stripLeadingReasoning(rawText);
}

module.exports = {
  OCR_TEXT_END_TAG,
  OCR_TEXT_START_TAG,
  buildVisionSystemPrompt,
  buildVisionPrompt,
  buildPostprocessSystemPrompt,
  buildPostprocessPrompt,
  extractAssistantText,
  extractVisionText,
};
