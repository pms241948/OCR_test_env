const { AppError } = require("../utils/errors");

function notFoundHandler(_req, _res, next) {
  next(new AppError("요청한 경로를 찾을 수 없습니다.", 404));
}

function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;
  const message = error.expose === false ? "서버 오류가 발생했습니다." : error.message;

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      details: error.details || null,
      stage: error.stage || null,
    },
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
