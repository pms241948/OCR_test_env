const path = require("path");

const multer = require("multer");

const { env } = require("../utils/env");
const { AppError } = require("../utils/errors");

const allowedExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg"]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, env.uploadDir);
  },
  filename: (_req, file, callback) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${timestamp}-${random}${extension}`);
  },
});

function fileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
    callback(new AppError("지원하지 않는 파일 형식입니다. PDF, PNG, JPG, JPEG만 허용됩니다.", 400));
    return;
  }

  callback(null, true);
}

const uploadSingle = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.maxFileSizeMb * 1024 * 1024,
  },
}).single("file");

module.exports = { uploadSingle };
