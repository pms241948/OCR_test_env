const { runOpenDataLoaderPdf } = require("./opendataloaderService");
const {
  resolvePostprocessSourceSelection,
  runPostprocessLlm,
} = require("./postprocessService");
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
  const sourceSelection = resolvePostprocessSourceSelection(config.postprocess || {});
  const upstage = sourceSelection.upstage
    ? await runUpstageDocumentParse({
        file,
        fileMetadata,
        config: config.upstage || {},
      })
    : null;
  const opendataloader = sourceSelection.opendataloader
    ? await runOpenDataLoaderPdf({
        file,
        fileMetadata,
        config: config.opendataloader || {},
      })
    : null;
  const pipelineVisionConfig = resolvePipelineVisionConfig(config.vision);
  const vision = sourceSelection.vision
    ? await runVisionOcr({
        file,
        fileMetadata,
        config: pipelineVisionConfig,
      })
    : null;
  const postprocess = await runPostprocessLlm({
    config: config.postprocess || {},
    fileMetadata,
    opendataloaderResult: opendataloader,
    upstageResult: upstage,
    visionResult: vision,
  });

  return {
    opendataloader,
    upstage,
    vision,
    postprocess,
  };
}

module.exports = {
  runFullPipeline,
};
