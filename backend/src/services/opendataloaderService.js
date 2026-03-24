const fs = require("fs/promises");
const path = require("path");

const { AppError } = require("../utils/errors");
const { createTempDir, isPdfFile } = require("../utils/file");

const SUPPORTED_OUTPUT_FORMATS = new Set(["json", "text", "html", "markdown"]);
const DEFAULT_OUTPUT_FORMATS = ["json", "text", "markdown", "html"];

let openDataLoaderModulePromise;

async function runOpenDataLoaderCli(inputPaths, options) {
  if (!openDataLoaderModulePromise) {
    openDataLoaderModulePromise = import("@opendataloader/pdf");
  }

  const module = await openDataLoaderModulePromise;

  const convert = module?.convert || module?.default?.convert;
  if (typeof convert === "function") {
    return convert(inputPaths, options);
  }

  const legacyRun = module?.run || module?.default?.run;
  if (typeof legacyRun === "function") {
    if (inputPaths.length !== 1) {
      throw new AppError("Legacy OpenDataLoader runner only supports one input path.", 500);
    }

    const formats = new Set(
      Array.isArray(options.format) ? options.format : String(options.format || "").split(",")
    );

    return legacyRun(inputPaths[0], {
      outputFolder: options.outputDir,
      generateMarkdown: formats.has("markdown"),
      generateHtml: formats.has("html"),
      keepLineBreaks: options.keepLineBreaks,
      contentSafetyOff: options.contentSafetyOff,
      replaceInvalidChars: options.replaceInvalidChars,
      debug: options.quiet === false,
    });
  }

  throw new AppError("OpenDataLoader PDF runner could not be loaded.", 500);
}

function normalizeOutputFormats(config) {
  const source = Array.isArray(config?.outputFormats)
    ? config.outputFormats
    : typeof config?.outputFormats === "string"
      ? config.outputFormats.split(",")
      : [];

  const normalized = source
    .map((format) => String(format || "").trim().toLowerCase())
    .filter((format) => SUPPORTED_OUTPUT_FORMATS.has(format));

  if (!normalized.length) {
    return DEFAULT_OUTPUT_FORMATS;
  }

  return [...new Set(normalized)];
}

function decodeHtmlEntities(input) {
  return String(input || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, value) => {
    const normalized = String(value || "").toLowerCase();

    if (normalized === "nbsp") {
      return " ";
    }
    if (normalized === "amp") {
      return "&";
    }
    if (normalized === "lt") {
      return "<";
    }
    if (normalized === "gt") {
      return ">";
    }
    if (normalized === "quot") {
      return '"';
    }
    if (normalized === "apos") {
      return "'";
    }
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith("#")) {
      return String.fromCodePoint(parseInt(normalized.slice(1), 10));
    }

    return entity;
  });
}

function normalizeTextBlock(input, { collapseLineBreaks = false } = {}) {
  const normalized = decodeHtmlEntities(String(input || ""))
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|table|thead|tbody|tfoot|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  if (!normalized) {
    return "";
  }

  if (collapseLineBreaks) {
    return normalized.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

function getChildNodes(node) {
  if (!node || typeof node !== "object") {
    return [];
  }

  const children = [];

  if (Array.isArray(node.kids)) {
    children.push(...node.kids);
  }
  if (Array.isArray(node["list items"])) {
    children.push(...node["list items"]);
  }

  return children;
}

function extractInlineText(node) {
  if (!node || typeof node !== "object") {
    return "";
  }

  const ownText =
    typeof node.content === "string" ? normalizeTextBlock(node.content, { collapseLineBreaks: true }) : "";
  const childText = getChildNodes(node)
    .map((child) => extractInlineText(child))
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!ownText) {
    return childText;
  }

  if (!childText || childText === ownText) {
    return ownText;
  }

  return `${ownText} ${childText}`.replace(/\s{2,}/g, " ").trim();
}

function formatTableRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return "";
  }

  const lines = rows
    .map((row) => {
      const cells = Array.isArray(row?.cells) ? row.cells : [];
      const cellValues = cells
        .map((cell) => extractInlineText(cell))
        .map((value) => value.replace(/\s{2,}/g, " ").trim())
        .filter((value) => value.length > 0);

      if (!cellValues.length) {
        return "";
      }

      return `| ${cellValues.join(" | ")} |`;
    })
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  return ["[Table]", ...lines].join("\n");
}

function collectStructuredBlocks(nodes, depth = 0) {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.flatMap((node) => collectStructuredBlocksFromNode(node, depth)).filter(Boolean);
}

function collectStructuredBlocksFromNode(node, depth = 0) {
  if (!node || typeof node !== "object") {
    return [];
  }

  const type = String(node.type || "").toLowerCase();
  const ownText =
    typeof node.content === "string" ? normalizeTextBlock(node.content, { collapseLineBreaks: false }) : "";

  if (type === "header" || type === "footer") {
    return [];
  }

  if (type === "heading") {
    const headingText = ownText || extractInlineText(node);
    if (!headingText) {
      return collectStructuredBlocks(getChildNodes(node), depth);
    }

    const level = Math.min(Math.max(Number(node["heading level"] || 1) || 1, 1), 6);
    return [`${"#".repeat(level)} ${headingText}`];
  }

  if (type === "table") {
    const tableText = formatTableRows(node.rows);
    const childBlocks = collectStructuredBlocks(getChildNodes(node), depth);
    return [tableText, ...childBlocks].filter(Boolean);
  }

  if (type === "list") {
    return collectStructuredBlocks(Array.isArray(node["list items"]) ? node["list items"] : [], depth + 1);
  }

  if (type === "list item") {
    const itemText = ownText || extractInlineText(node);
    const indent = "  ".repeat(Math.max(depth - 1, 0));
    const childBlocks = collectStructuredBlocks(
      Array.isArray(node.kids) ? node.kids : [],
      depth + 1
    ).filter((child) => child !== itemText);

    if (!itemText) {
      return childBlocks;
    }

    return [`${indent}- ${itemText}`, ...childBlocks];
  }

  if (type === "paragraph" || type === "caption") {
    if (ownText) {
      return [ownText];
    }

    return collectStructuredBlocks(getChildNodes(node), depth);
  }

  const childBlocks = collectStructuredBlocks(getChildNodes(node), depth);

  if (!childBlocks.length && ownText) {
    return [ownText];
  }

  return childBlocks;
}

function joinStructuredBlocks(blocks) {
  return blocks
    .map((block) => String(block || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildStructuredText(outputs) {
  if (outputs.json && Array.isArray(outputs.json.kids)) {
    const structured = joinStructuredBlocks(collectStructuredBlocks(outputs.json.kids));
    if (structured) {
      return structured;
    }
  }

  return normalizeTextBlock(outputs.text || outputs.markdown || outputs.html || "", {
    collapseLineBreaks: false,
  });
}

function buildPlainText(outputs) {
  return normalizeTextBlock(outputs.text || outputs.markdown || outputs.html || "", {
    collapseLineBreaks: false,
  });
}

function buildDownloadFileName(fileName, suffix) {
  const parsed = path.parse(fileName || "document.pdf");
  return `${parsed.name}.opendataloader.${suffix}`;
}

async function readGeneratedOutputs(outputDir) {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const findByExtension = (extensions) =>
    files.find((fileName) =>
      extensions.some((extension) => fileName.toLowerCase().endsWith(extension))
    );

  const jsonFile = findByExtension([".json"]);
  const markdownFile = findByExtension([".md", ".markdown"]);
  const htmlFile = findByExtension([".html", ".htm"]);
  const textFile = findByExtension([".txt", ".text"]);

  const jsonRaw = jsonFile
    ? await fs.readFile(path.join(outputDir, jsonFile), "utf8")
    : null;
  const markdown = markdownFile
    ? await fs.readFile(path.join(outputDir, markdownFile), "utf8")
    : "";
  const html = htmlFile
    ? await fs.readFile(path.join(outputDir, htmlFile), "utf8")
    : "";
  const text = textFile
    ? await fs.readFile(path.join(outputDir, textFile), "utf8")
    : "";

  return {
    json: jsonRaw ? JSON.parse(jsonRaw) : null,
    markdown,
    html,
    text,
  };
}

function buildDownloads(fileMetadata, outputs, selectedFormats) {
  const selected = new Set(Array.isArray(selectedFormats) ? selectedFormats : DEFAULT_OUTPUT_FORMATS);
  const downloads = [];

  if (outputs.markdown && selected.has("markdown")) {
    downloads.push({
      key: "markdown",
      label: "Markdown",
      fileName: buildDownloadFileName(fileMetadata.fileName, "md"),
      mimeType: "text/markdown;charset=utf-8",
      content: outputs.markdown,
    });
  }

  if (outputs.html && selected.has("html")) {
    downloads.push({
      key: "html",
      label: "HTML",
      fileName: buildDownloadFileName(fileMetadata.fileName, "html"),
      mimeType: "text/html;charset=utf-8",
      content: outputs.html,
    });
  }

  if (outputs.text && selected.has("text")) {
    downloads.push({
      key: "text",
      label: "Text",
      fileName: buildDownloadFileName(fileMetadata.fileName, "txt"),
      mimeType: "text/plain;charset=utf-8",
      content: outputs.text,
    });
  }

  if (outputs.json && selected.has("json")) {
    downloads.push({
      key: "json",
      label: "JSON",
      fileName: buildDownloadFileName(fileMetadata.fileName, "json"),
      mimeType: "application/json",
      content: JSON.stringify(outputs.json, null, 2),
    });
  }

  return downloads;
}

async function runOpenDataLoaderPdf({ file, fileMetadata, config = {} }) {
  if (!isPdfFile(fileMetadata || file)) {
    throw new AppError("OpenDataLoader PDF only supports PDF uploads.", 400);
  }

  const outputDir = await createTempDir("opendataloader-output-");
  const requestedOutputFormats = normalizeOutputFormats(config);
  const internalOutputFormats = [...new Set(["json", "text", ...requestedOutputFormats])];
  const useStructTree = config.useStructTree !== false;

  try {
    await runOpenDataLoaderCli([file.path], {
      outputDir,
      format: internalOutputFormats,
      quiet: config.quiet !== false,
      keepLineBreaks: Boolean(config.keepLineBreaks),
      useStructTree,
      contentSafetyOff: config.contentSafetyOff || undefined,
      replaceInvalidChars:
        typeof config.replaceInvalidChars === "string" && config.replaceInvalidChars.length > 0
          ? config.replaceInvalidChars
          : undefined,
      password: config.password || undefined,
    });

    const outputs = await readGeneratedOutputs(outputDir);
    const structuredText = buildStructuredText(outputs);
    const plainText =
      buildPlainText(outputs) ||
      structuredText ||
      (outputs.json ? JSON.stringify(outputs.json, null, 2) : "");
    const primaryText = structuredText || plainText;

    return {
      stage: "opendataloader_pdf",
      statusCode: 200,
      request: {
        engine: "@opendataloader/pdf",
        options: {
          format: requestedOutputFormats,
          internalFormat: internalOutputFormats,
          keepLineBreaks: Boolean(config.keepLineBreaks),
          useStructTree,
          contentSafetyOff: config.contentSafetyOff || "",
          replaceInvalidChars: config.replaceInvalidChars || "",
          quiet: config.quiet !== false,
        },
      },
      content: {
        text: structuredText || plainText,
        plainText,
        structuredText,
        html: outputs.html || "",
        markdown: outputs.markdown || "",
      },
      text: primaryText,
      raw: outputs.json || {
        markdown: outputs.markdown || "",
        html: outputs.html || "",
        text: plainText,
        structuredText,
      },
      downloads: buildDownloads(fileMetadata, outputs, requestedOutputFormats),
      elements: Array.isArray(outputs.json?.kids) ? outputs.json.kids : [],
      pageCount: Number(outputs.json?.["number of pages"] || fileMetadata.pageCount || 0) || null,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("OpenDataLoader PDF parsing failed.", 500, {
      message: error?.message || String(error),
    });
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = {
  runOpenDataLoaderPdf,
};
