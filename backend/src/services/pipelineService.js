const { runPostprocessLlm } = require("./postprocessService");
const { runUpstageDocumentParse } = require("./upstageService");
const { runVisionOcr } = require("./visionLlmService");

async function runFullPipeline({ file, fileMetadata, config }) {
  const upstage = await runUpstageDocumentParse({
    file,
    fileMetadata,
    config: config.upstage || {},
  });
  const vision = await runVisionOcr({
    file,
    fileMetadata,
    config: config.vision || {},
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
