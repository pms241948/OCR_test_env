const express = require("express");

const { uploadSingle } = require("../middleware/upload");
const { asyncHandler } = require("../utils/errors");
const {
  health,
  runUpstage,
  runVisionLlm,
  runPostprocess,
  runAll,
  checkUpstageEndpoints,
  listHistory,
  createHistoryEntry,
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} = require("../controllers/apiController");

const apiRouter = express.Router();

apiRouter.get("/health", asyncHandler(health));
apiRouter.post("/ocr/upstage", uploadSingle, asyncHandler(runUpstage));
apiRouter.post("/ocr/vision-llm", uploadSingle, asyncHandler(runVisionLlm));
apiRouter.post("/postprocess", asyncHandler(runPostprocess));
apiRouter.post("/run-all", uploadSingle, asyncHandler(runAll));
apiRouter.post("/upstage/check-endpoints", asyncHandler(checkUpstageEndpoints));
apiRouter.get("/history", asyncHandler(listHistory));
apiRouter.post("/history", asyncHandler(createHistoryEntry));
apiRouter.get("/presets", asyncHandler(listPresets));
apiRouter.post("/presets", asyncHandler(createPreset));
apiRouter.put("/presets/:id", asyncHandler(updatePreset));
apiRouter.delete("/presets/:id", asyncHandler(deletePreset));

module.exports = { apiRouter };
