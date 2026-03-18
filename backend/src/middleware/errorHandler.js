const { AppError } = require("../utils/errors");

function notFoundHandler(_req, _res, next) {
  next(new AppError("Requested route was not found.", 404));
}

function errorHandler(error, req, res, _next) {
  const statusCode = error.statusCode || 500;
  const message = error.expose === false ? "Internal server error." : error.message;
  const details = error.details || null;

  console.error("[backend:error]", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    message: error.message,
    stage: error.stage || null,
    details,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      details,
      stage: error.stage || null,
    },
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
