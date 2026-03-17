const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const rootDir = path.resolve(process.cwd());
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads"));

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3001),
  dataDir,
  uploadDir,
  databasePath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "app.db")),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 25),
  defaultTimeoutMs: Number(process.env.DEFAULT_TIMEOUT_MS || 300000),
  defaultRetryCount: Number(process.env.DEFAULT_RETRY_COUNT || 1),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  allowPrivateUrls: String(process.env.ALLOW_PRIVATE_URLS || "true") === "true",
  logLevel: process.env.LOG_LEVEL || "info",
};

module.exports = { env };
