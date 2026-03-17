const {
  addHistoryEntry,
  createPresetRecord,
  deletePresetRecord,
  listHistoryEntries,
  listPresetRecords,
  updatePresetRecord,
} = require("../db/database");
const { AppError } = require("../utils/errors");
const { cleanupUploadedFile, getDocumentMetadata, sha256File } = require("../utils/file");
const { parseJsonField } = require("../utils/parsing");
const {
  checkEndpoints,
  runUpstageDocumentParse,
} = require("../services/upstageService");
const { runVisionOcr } = require("../services/visionLlmService");
const { runPostprocessLlm } = require("../services/postprocessService");
const { runFullPipeline } = require("../services/pipelineService");

function requireFile(file) {
  if (!file) {
    throw new AppError("업로드 파일이 필요합니다.", 400);
  }
}

function getMultipartConfig(req) {
  return parseJsonField(req.body.config, {});
}

async function buildFileContext(file) {
  const metadata = await getDocumentMetadata(file.path, file);
  const fileHash = await sha256File(file.path);

  return {
    metadata,
    fileHash,
  };
}

async function persistRun({
  runType,
  file,
  fileContext,
  config,
  roi,
  result,
}) {
  return addHistoryEntry({
    runType,
    fileName: fileContext?.metadata?.fileName || file?.originalname || null,
    fileHash: fileContext?.fileHash || null,
    mimeType: fileContext?.metadata?.mimeType || file?.mimetype || null,
    fileSize: fileContext?.metadata?.fileSize || file?.size || null,
    filePages: fileContext?.metadata?.pageCount || null,
    config,
    roi,
    result,
  });
}

async function health(_req, res) {
  res.json({
    success: true,
    data: {
      status: "ok",
      now: new Date().toISOString(),
    },
  });
}

async function runUpstage(req, res) {
  requireFile(req.file);
  const config = getMultipartConfig(req);

  let fileContext;
  try {
    fileContext = await buildFileContext(req.file);
    const result = await runUpstageDocumentParse({
      file: req.file,
      fileMetadata: fileContext.metadata,
      config,
    });

    const historyId = await persistRun({
      runType: "upstage",
      file: req.file,
      fileContext,
      config,
      roi: null,
      result,
    });

    res.json({
      success: true,
      data: {
        historyId,
        file: fileContext.metadata,
        ...result,
      },
    });
  } finally {
    await cleanupUploadedFile(req.file?.path);
  }
}

async function runVisionLlm(req, res) {
  requireFile(req.file);
  const config = getMultipartConfig(req);

  let fileContext;
  try {
    fileContext = await buildFileContext(req.file);
    const result = await runVisionOcr({
      file: req.file,
      fileMetadata: fileContext.metadata,
      config,
    });

    const historyId = await persistRun({
      runType: "vision_llm",
      file: req.file,
      fileContext,
      config,
      roi: result.range?.roi || null,
      result,
    });

    res.json({
      success: true,
      data: {
        historyId,
        file: fileContext.metadata,
        ...result,
      },
    });
  } finally {
    await cleanupUploadedFile(req.file?.path);
  }
}

async function runPostprocess(req, res) {
  const body = req.body || {};
  const config = body.config || {};
  const file = body.file || {};
  const upstageResult = body.upstageResult;
  const visionResult = body.visionResult;

  if (!upstageResult || !visionResult) {
    throw new AppError("후처리에는 Upstage 결과와 Vision 결과가 모두 필요합니다.", 400);
  }

  const result = await runPostprocessLlm({
    config,
    fileMetadata: file,
    upstageResult,
    visionResult,
  });

  const historyId = await addHistoryEntry({
    runType: "postprocess",
    fileName: file.fileName || null,
    fileHash: file.fileHash || null,
    mimeType: file.mimeType || null,
    fileSize: file.fileSize || null,
    filePages: file.pageCount || null,
    config,
    roi: visionResult?.range?.roi || null,
    result,
  });

  res.json({
    success: true,
    data: {
      historyId,
      ...result,
    },
  });
}

async function runAll(req, res) {
  requireFile(req.file);
  const config = getMultipartConfig(req);

  let fileContext;
  try {
    fileContext = await buildFileContext(req.file);
    const result = await runFullPipeline({
      file: req.file,
      fileMetadata: fileContext.metadata,
      config,
    });

    const historyId = await persistRun({
      runType: "full_pipeline",
      file: req.file,
      fileContext,
      config,
      roi: result?.vision?.range?.roi || null,
      result,
    });

    res.json({
      success: true,
      data: {
        historyId,
        file: fileContext.metadata,
        ...result,
      },
    });
  } finally {
    await cleanupUploadedFile(req.file?.path);
  }
}

async function checkUpstageEndpoints(req, res) {
  const payload = req.body || {};
  const result = await checkEndpoints(payload);

  res.json({
    success: true,
    data: result,
  });
}

async function listHistory(req, res) {
  const limit = Number(req.query.limit || 20);
  const items = listHistoryEntries(limit);

  res.json({
    success: true,
    data: items,
  });
}

async function createHistoryEntry(req, res) {
  const body = req.body || {};
  const id = addHistoryEntry({
    runType: body.runType || "manual",
    fileName: body.fileName || null,
    fileHash: body.fileHash || null,
    mimeType: body.mimeType || null,
    fileSize: body.fileSize || null,
    filePages: body.filePages || null,
    config: body.config || {},
    roi: body.roi || null,
    result: body.result || {},
  });

  res.status(201).json({
    success: true,
    data: { id },
  });
}

async function listPresets(_req, res) {
  const items = listPresetRecords();
  res.json({
    success: true,
    data: items,
  });
}

async function createPreset(req, res) {
  const body = req.body || {};

  if (!body.name) {
    throw new AppError("프리셋 이름이 필요합니다.", 400);
  }

  const id = createPresetRecord({
    name: body.name,
    description: body.description || "",
    config: body.config || {},
  });

  res.status(201).json({
    success: true,
    data: { id },
  });
}

async function updatePreset(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};

  if (!id) {
    throw new AppError("유효한 프리셋 ID가 필요합니다.", 400);
  }

  updatePresetRecord(id, {
    name: body.name,
    description: body.description || "",
    config: body.config || {},
  });

  res.json({
    success: true,
    data: { id },
  });
}

async function deletePreset(req, res) {
  const id = Number(req.params.id);

  if (!id) {
    throw new AppError("유효한 프리셋 ID가 필요합니다.", 400);
  }

  deletePresetRecord(id);

  res.json({
    success: true,
    data: { id },
  });
}

module.exports = {
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
};
