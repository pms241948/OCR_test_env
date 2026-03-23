const { runPostprocessLlm } = require("./postprocessService");
const { runUpstageDocumentParse } = require("./upstageService");
const { runVisionOcr } = require("./visionLlmService");

function resolvePipelineVisionConfig(input) {
  if (!input || typeof input !== "object") {
    return {};
  }

  if (Array.isArray(input.models)) {
    return (
      input.models.find((model) => model && model.id === input.activeModelId) ||
      input.models[0] ||
      {}
    );
  }

  return input;
}

async function runFullPipeline({ file, fileMetadata, config }) {
  const upstage = await runUpstageDocumentParse({
    file,
    fileMetadata,
    config: config.upstage || {},
  });
  const pipelineVisionConfig = resolvePipelineVisionConfig(config.vision);
  const vision = await runVisionOcr({
    file,
    fileMetadata,
    config: pipelineVisionConfig,
  });
  const postprocess = await runPostprocessLlm({
    config: config.postprocess || {},
    fileMetadata,
    upstageResult: upstage,
    visionResult: vision,
  });

  return {
    upstage,
    vision,
    postprocess,
  };
}

module.exports = {
  runFullPipeline,
};
