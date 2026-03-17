const fs = require("fs/promises");
const path = require("path");

const sharp = require("sharp");

const { AppError } = require("../utils/errors");
const { requestJson } = require("../utils/http");
const { parseJsonField } = require("../utils/parsing");
const { buildVisionPrompt, extractAssistantText } = require("../utils/prompt");
const {
  createTempDir,
  fileToDataUrl,
  isPdfFile,
  normalizeRoi,
  pageRangeFromConfig,
} = require("../utils/file");
const { renderPdfPagesToPng } = require("../utils/pdf");
const { validateTargetUrl } = require("../utils/urlValidator");

async function cropImage(inputPath, roi, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new AppError("이미지 크기를 확인할 수 없습니다.", 400);
  }

  const normalized = normalizeRoi(roi);
  const left = Math.round(normalized.x * metadata.width);
  const top = Math.round(normalized.y * metadata.height);
  const width = Math.max(1, Math.round(normalized.width * metadata.width));
  const height = Math.max(1, Math.round(normalized.height * metadata.height));

  await image
    .extract({
      left: Math.min(left, metadata.width - 1),
      top: Math.min(top, metadata.height - 1),
      width: Math.min(width, metadata.width - left),
      height: Math.min(height, metadata.height - top),
    })
    .png()
    .toFile(outputPath);

  return {
    path: outputPath,
    width,
    height,
    roi: normalized,
  };
}

function resolveRange(config, fileMetadata) {
  const rangeMode = config.rangeMode || "full_document";
  const roi = config.roi ? normalizeRoi(config.roi) : null;

  if (!["full_document", "page_range", "roi", "page_and_roi"].includes(rangeMode)) {
    throw new AppError("지원하지 않는 Vision 범위 모드입니다.", 400);
  }

  if (!isPdfFile(fileMetadata)) {
    return {
      rangeMode,
      pages: [1],
      roi: rangeMode === "roi" || rangeMode === "page_and_roi" ? roi : null,
    };
  }

  if (rangeMode === "full_document") {
    return {
      rangeMode,
      pages: Array.from({ length: fileMetadata.pageCount || 1 }, (_, index) => index + 1),
      roi: null,
    };
  }

  if (rangeMode === "page_range") {
    return {
      rangeMode,
      pages: pageRangeFromConfig(config, fileMetadata.pageCount),
      roi: null,
    };
  }

  if (rangeMode === "roi") {
    const targetPage = Number(config.roi?.page || config.pageRangeStart || 1);
    return {
      rangeMode,
      pages: [targetPage],
      roi,
    };
  }

  return {
    rangeMode,
    pages: pageRangeFromConfig(config, fileMetadata.pageCount),
    roi,
  };
}

async function prepareImageAssets(file, fileMetadata, config) {
  const tempDir = await createTempDir("vision-assets-");
  const range = resolveRange(config, fileMetadata);
  const assets = [];

  try {
    if (isPdfFile(fileMetadata)) {
      const rendered = await renderPdfPagesToPng(file.path, range.pages, tempDir);

      for (const item of rendered) {
        if (range.roi) {
          const outputPath = path.join(tempDir, `crop-page-${item.page}.png`);
          const cropped = await cropImage(item.path, range.roi, outputPath);
          assets.push({
            page: item.page,
            path: cropped.path,
            width: cropped.width,
            height: cropped.height,
            mimeType: "image/png",
            cropped: true,
          });
        } else {
          const metadata = await sharp(item.path).metadata();
          assets.push({
            page: item.page,
            path: item.path,
            width: metadata.width || null,
            height: metadata.height || null,
            mimeType: "image/png",
            cropped: false,
          });
        }
      }
    } else if (range.roi) {
      const outputPath = path.join(tempDir, "crop-image.png");
      const cropped = await cropImage(file.path, range.roi, outputPath);
      assets.push({
        page: 1,
        path: cropped.path,
        width: cropped.width,
        height: cropped.height,
        mimeType: "image/png",
        cropped: true,
      });
    } else {
      const metadata = await sharp(file.path).metadata();
      assets.push({
        page: 1,
        path: file.path,
        width: metadata.width || null,
        height: metadata.height || null,
        mimeType: file.mimetype,
        cropped: false,
      });
    }

    return {
      tempDir,
      range,
      assets,
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function runVisionOcr({ file, fileMetadata, config }) {
  const url = config.url;

  if (!url) {
    throw new AppError("비전 LLM 호출 URL이 필요합니다.", 400);
  }

  if (!config.model) {
    throw new AppError("비전 LLM 모델명이 필요합니다.", 400);
  }

  await validateTargetUrl(url);

  const timeoutMs = Number(config.timeoutMs || 300000);
  const retryCount = Number(config.retryCount || 1);
  const extraHeaders = parseJsonField(config.headersJson, {});
  const extraBody = parseJsonField(config.extraBodyJson, {});
  const prepared = await prepareImageAssets(file, fileMetadata, config);

  try {
    const userContent = [
      {
        type: "text",
        text: buildVisionPrompt({
          fileMetadata,
          config,
          range: prepared.range,
        }),
      },
    ];

    for (const asset of prepared.assets) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: await fileToDataUrl(asset.path, asset.mimeType),
        },
      });
    }

    const payload = {
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            config.systemPrompt ||
            "You extract OCR text from document images with high fidelity.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      temperature: Number(config.temperature ?? 0.1),
      max_tokens: Number(config.maxTokens || 4000),
      top_p: Number(config.topP ?? 1),
      ...extraBody,
    };

    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await requestJson({
      method: "POST",
      url,
      headers,
      data: payload,
      timeoutMs,
      retryCount,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return {
      stage: "vision_llm",
      statusCode: response.status,
      request: {
        url,
        payload,
      },
      usedPrompt: {
        systemPrompt:
          config.systemPrompt ||
          "You extract OCR text from document images with high fidelity.",
        userPrompt: config.userPrompt || "",
        compiledPrompt: userContent[0].text,
        extractionRules: config.extractionRules || "",
      },
      usedReferenceText: config.referenceEnabled ? config.referenceText || "" : "",
      range: {
        mode: prepared.range.rangeMode,
        pages: prepared.range.pages,
        roi: prepared.range.roi,
      },
      assets: prepared.assets.map((item) => ({
        page: item.page,
        width: item.width,
        height: item.height,
        mimeType: item.mimeType,
        cropped: item.cropped,
      })),
      raw: response.data,
      text: extractAssistantText(response.data),
    };
  } finally {
    await fs.rm(prepared.tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = {
  runVisionOcr,
};
