const fs = require("fs/promises");
const path = require("path");

const { AppError } = require("../utils/errors");
const { createTempDir, isPdfFile } = require("../utils/file");

const SUPPORTED_OUTPUT_FORMATS = new Set(["json", "text", "html", "markdown"]);

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
    return ["json", "markdown", "html"];
  }

  return [...new Set(normalized)];
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

function buildDownloads(fileMetadata, outputs) {
  const downloads = [];

  if (outputs.markdown) {
    downloads.push({
      key: "markdown",
      label: "Markdown",
      fileName: buildDownloadFileName(fileMetadata.fileName, "md"),
      mimeType: "text/markdown;charset=utf-8",
      content: outputs.markdown,
    });
  }

  if (outputs.html) {
    downloads.push({
      key: "html",
      label: "HTML",
      fileName: buildDownloadFileName(fileMetadata.fileName, "html"),
      mimeType: "text/html;charset=utf-8",
      content: outputs.html,
    });
  }

  if (outputs.text) {
    downloads.push({
      key: "text",
      label: "Text",
      fileName: buildDownloadFileName(fileMetadata.fileName, "txt"),
      mimeType: "text/plain;charset=utf-8",
      content: outputs.text,
    });
  }

  if (outputs.json) {
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
  const outputFormats = normalizeOutputFormats(config);

  try {
    await runOpenDataLoaderCli([file.path], {
      outputDir,
      format: outputFormats,
      quiet: config.quiet !== false,
      keepLineBreaks: Boolean(config.keepLineBreaks),
      useStructTree: Boolean(config.useStructTree),
      contentSafetyOff: config.contentSafetyOff || undefined,
      replaceInvalidChars:
        typeof config.replaceInvalidChars === "string" && config.replaceInvalidChars.length > 0
          ? config.replaceInvalidChars
          : undefined,
      password: config.password || undefined,
    });

    const outputs = await readGeneratedOutputs(outputDir);
    const primaryText =
      outputs.markdown ||
      outputs.text ||
      (outputs.json ? JSON.stringify(outputs.json, null, 2) : "");

    return {
      stage: "opendataloader_pdf",
      statusCode: 200,
      request: {
        engine: "@opendataloader/pdf",
        options: {
          format: outputFormats,
          keepLineBreaks: Boolean(config.keepLineBreaks),
          useStructTree: Boolean(config.useStructTree),
          contentSafetyOff: config.contentSafetyOff || "",
          replaceInvalidChars: config.replaceInvalidChars || "",
          quiet: config.quiet !== false,
        },
      },
      content: {
        text: outputs.text || primaryText,
        html: outputs.html || "",
        markdown: outputs.markdown || "",
      },
      text: primaryText,
      raw: outputs.json || {
        markdown: outputs.markdown || "",
        html: outputs.html || "",
        text: outputs.text || "",
      },
      downloads: buildDownloads(fileMetadata, outputs),
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
