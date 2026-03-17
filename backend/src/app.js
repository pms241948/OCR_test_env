const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { env } = require("./utils/env");
const { ensureAppDirectories } = require("./utils/file");
const { initDatabase } = require("./db/database");
const { apiRouter } = require("./routes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

ensureAppDirectories();
initDatabase();

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app };
