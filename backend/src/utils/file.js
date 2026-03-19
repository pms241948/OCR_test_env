const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

const { env } = require("./env");
const { AppError } = require("./errors");

function isAsciiOnly(value) {
  return !/[^\u0000-\u007f]/.test(value || "");
}

function countMatches(value, pattern) {
  return (value.match(pattern) || []).length;
}

function normalizeUploadFilename(fileName) {
  if (!fileName || isAsciiOnly(fileName)) {
    return fileName;
  }

  const decoded = Buffer.from(fileName, "latin1").toString("utf8");
  const originalHangul = countMatches(fileName, /[\uac00-\ud7a3]/g);
  const decodedHangul = countMatches(decoded, /[\uac00-\ud7a3]/g);
  const originalMojibake = countMatches(fileName, /[\u00C0-\u00FF\u0080-\u00BF]/g);
  const decodedReplacement = countMatches(decoded, /\uFFFD/g);

  if (decodedReplacement > 0) {
    return fileName;
  }

  if (decodedHangul > originalHangul) {
    return decoded;
  }

  if (originalHangul === 0 && originalMojibake > 0 && decoded !== fileName) {
    return decoded;
  }

  return fileName;
}

function ensureAppDirectories() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(env.dataDir, { recursive: true });
}

function isPdfFile(fileMetadataOrFile) {
  const mimeType = fileMetadataOrFile?.mimeType || fileMetadataOrFile?.mimetype || "";
  return mimeType === "application/pdf";
}

function isImageFile(fileMetadataOrFile) {
  const mimeType = fileMetadataOrFile?.mimeType || fileMetadataOrFile?.mimetype || "";
  return ["image/png", "image/jpeg"].includes(mimeType);
}

async function getPdfPageCount(filePath) {
  const bytes = await fsp.readFile(filePath);
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount();
}

async function getImageDimensions(filePath) {
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width || null,
    height: metadata.height || null,
  };
}

async function getDocumentMetadata(filePath, file) {
  const metadata = {
    fileName: normalizeUploadFilename(file.originalname),
    fileSize: file.size,
    mimeType: file.mimetype,
    pageCount: 1,
    width: null,
    height: null,
  };

  if (isPdfFile(file)) {
    metadata.pageCount = await getPdfPageCount(filePath);
  } else if (isImageFile(file)) {
    const dimensions = await getImageDimensions(filePath);
    metadata.width = dimensions.width;
    metadata.height = dimensions.height;
  } else {
    throw new AppError("지원하지 않는 파일 형식입니다.", 400);
  }

  return metadata;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function cleanupUploadedFile(filePath) {
  if (!filePath) {
    return;
  }

  await fsp.unlink(filePath).catch(() => null);
}

async function createTempDir(prefix = "ocr-temp-") {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function fileToDataUrl(filePath, mimeType) {
  const buffer = await fsp.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeRoi(roi) {
  if (!roi) {
    return null;
  }

  const x = Number(roi.x);
  const y = Number(roi.y);
  const width = Number(roi.width);
  const height = Number(roi.height);

  if ([x, y, width, height].some((value) => Number.isNaN(value))) {
    throw new AppError("ROI 좌표는 숫자여야 합니다.", 400);
  }

  if (width <= 0 || height <= 0) {
    throw new AppError("ROI width와 height는 0보다 커야 합니다.", 400);
  }

  const normalized = {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0.0001, Math.min(1, width)),
    height: Math.max(0.0001, Math.min(1, height)),
    page: roi.page ? Number(roi.page) : undefined,
  };

  if (normalized.x + normalized.width > 1) {
    normalized.width = 1 - normalized.x;
  }

  if (normalized.y + normalized.height > 1) {
    normalized.height = 1 - normalized.y;
  }

  return normalized;
}

function normalizePageRois(pageRois) {
  if (!pageRois || typeof pageRois !== "object") {
    return {};
  }

  return Object.entries(pageRois).reduce((accumulator, [pageKey, roi]) => {
    const normalizedPage = Number(pageKey);
    if (!Number.isInteger(normalizedPage) || normalizedPage < 1) {
      return accumulator;
    }

    const normalizedRoi = normalizeRoi(roi);
    if (!normalizedRoi) {
      return accumulator;
    }

    accumulator[String(normalizedPage)] = {
      ...normalizedRoi,
      page: normalizedPage,
    };
    return accumulator;
  }, {});
}

function pageRangeFromConfig(config, totalPages = 1) {
  const start = Math.max(1, Number(config.pageRangeStart || 1));
  const end = Math.min(totalPages || 1, Number(config.pageRangeEnd || totalPages || 1));

  if (start > end) {
    throw new AppError("페이지 범위 시작값이 종료값보다 클 수 없습니다.", 400);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

module.exports = {
  cleanupUploadedFile,
  createTempDir,
  ensureAppDirectories,
  fileToDataUrl,
  getDocumentMetadata,
  isImageFile,
  isPdfFile,
  normalizeRoi,
  normalizePageRois,
  normalizeUploadFilename,
  pageRangeFromConfig,
  sha256File,
};
