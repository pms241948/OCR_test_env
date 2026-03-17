const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { AppError } = require("./errors");

const execFileAsync = promisify(execFile);

async function renderSinglePage(filePath, page, outputDir) {
  const prefix = path.join(outputDir, `page-${page}`);

  try {
    await execFileAsync("pdftoppm", [
      "-png",
      "-r",
      "150",
      "-f",
      String(page),
      "-l",
      String(page),
      filePath,
      prefix,
    ]);
  } catch (error) {
    throw new AppError(
      "PDF 렌더링에 실패했습니다. Docker 환경에서 poppler-utils가 설치되어 있는지 확인하세요.",
      500,
      { message: error.message }
    );
  }

  const candidates = await fs.readdir(outputDir);
  const expectedPrefix = `page-${page}-`;
  const filename = candidates.find((name) => name.startsWith(expectedPrefix) && name.endsWith(".png"));

  if (!filename) {
    throw new AppError("PDF 페이지 렌더링 결과를 찾을 수 없습니다.", 500);
  }

  return {
    page,
    path: path.join(outputDir, filename),
  };
}

async function renderPdfPagesToPng(filePath, pages, outputDir) {
  const results = [];

  for (const page of pages) {
    results.push(await renderSinglePage(filePath, page, outputDir));
  }

  return results;
}

module.exports = {
  renderPdfPagesToPng,
};
