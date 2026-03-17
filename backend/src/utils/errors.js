class AppError extends Error {
  constructor(message, statusCode = 500, details = null, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
    this.stage = options.stage || null;
    this.expose = options.expose ?? true;
  }
}

function asyncHandler(handler) {
  return async function wrappedHandler(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  AppError,
  asyncHandler,
};
