const express = require("express");

const { uploadSingle } = require("../middleware/upload");
const { asyncHandler } = require("../utils/errors");
const {
  health,
  runUpstage,
  runOpenDataLoader,
  runVisionLlm,
  testUpstageCall,
  testVisionCall,
  runPostprocess,
  testPostprocessCall,
  runAll,
  checkUpstageEndpoints,
  listHistory,
  createHistoryEntry,
  deleteHistory,
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} = require("../controllers/apiController");

const apiRouter = express.Router();

apiRouter.get("/health", asyncHandler(health));
apiRouter.post("/ocr/upstage", uploadSingle, asyncHandler(runUpstage));
apiRouter.post("/ocr/opendataloader", uploadSingle, asyncHandler(runOpenDataLoader));
apiRouter.post("/ocr/vision-llm", uploadSingle, asyncHandler(runVisionLlm));
apiRouter.post("/ocr/upstage/test-call", asyncHandler(testUpstageCall));
apiRouter.post("/ocr/vision-llm/test-call", asyncHandler(testVisionCall));
apiRouter.post("/postprocess", asyncHandler(runPostprocess));
apiRouter.post("/postprocess/test-call", asyncHandler(testPostprocessCall));
apiRouter.post("/run-all", uploadSingle, asyncHandler(runAll));
apiRouter.post("/upstage/check-endpoints", asyncHandler(checkUpstageEndpoints));
apiRouter.get("/history", asyncHandler(listHistory));
apiRouter.post("/history", asyncHandler(createHistoryEntry));
apiRouter.delete("/history/:id", asyncHandler(deleteHistory));
apiRouter.get("/presets", asyncHandler(listPresets));
apiRouter.post("/presets", asyncHandler(createPreset));
apiRouter.put("/presets/:id", asyncHandler(updatePreset));
apiRouter.delete("/presets/:id", asyncHandler(deletePreset));

module.exports = { apiRouter };
