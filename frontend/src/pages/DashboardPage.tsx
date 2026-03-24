import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

import { DocumentPreview } from "../components/DocumentPreview";
import { JsonViewer } from "../components/JsonViewer";
import { OpendataloaderResultPane } from "../components/OpendataloaderResultPane";
import { ResultPane } from "../components/ResultPane";
import { RoiSelector } from "../components/RoiSelector";
import { SectionCard } from "../components/SectionCard";
import {
  createVisionModelConfig,
  defaults,
  getVisionModelDisplayLabel,
  normalizeVisionRegistry,
  useAppStore,
} from "../stores/useAppStore";
import {
  checkUpstageEndpointsApi,
  createPresetApi,
  deleteHistoryApi,
  deletePresetApi,
  fetchHistoryApi,
  fetchPresetsApi,
  runAllApi,
  runOpenDataLoaderApi,
  runPostprocessApi,
  testPostprocessCallApi,
  testUpstageCallApi,
  testVisionCallApi,
  runUpstageApi,
  runVisionApi,
  updatePresetApi,
} from "../utils/api";
import {
  formatBytes,
  getLocalFileMeta,
  getSupportedFileKind,
  isoToLabel,
  readTextFile,
} from "../utils/file";
import { translate, type AppLanguage } from "../utils/i18n";
import {
  deleteUploadedDocumentFromLibrary,
  loadUploadLibrary,
  saveUploadedDocumentToLibrary,
  setActiveUploadLibraryDocument,
  UPLOAD_LIBRARY_LIMIT_ERROR,
} from "../utils/uploadLibrary";
import type {
  DownloadableResultFile,
  FileMeta,
  HistoryRecord,
  PageRoiMap,
  PresetRecord,
  RangeMode,
  Roi,
  StageKey,
  StageResponse,
  StoredConfigBundle,
  UploadedDocument,
  VisionModelConfig,
  VisionModelResult,
  VisionRegistry,
} from "../utils/types";

type RunStatus = {
  state: "idle" | "running" | "success" | "error";
  message?: string;
};

type RunStatusMap = Record<StageKey, RunStatus>;
type ResultWorkspaceView =
  | "compare"
  | "opendataloader"
  | "upstage"
  | "vision"
  | "postprocess"
  | "insights";
type CompareWorkspaceMode = "upstage_vision" | "vision_postprocess" | "upstage_postprocess" | "all";
type ResultWorkspaceStage = Exclude<StageKey, "pipeline">;
type WorkspaceMenuKey = "document" | "ocr_setup" | "run_center" | "results" | "library";
type OcrSetupView = "opendataloader" | "upstage" | "vision" | "postprocess";
type ResultPaneData = {
  title: string;
  text: string;
  raw: unknown;
  statusCode?: number;
  promptPreview?: string;
  referencePreview?: string;
  errorMessage?: string;
  downloads?: DownloadableResultFile[];
  opendataloaderResult?: StageResponse | null;
};

const PRESETS_PER_PAGE = 5;
const HISTORY_PER_PAGE = 5;
const ACTIVE_TAB_CLASS = "bg-ink text-white shadow-sm";
const ACTIVE_PILL_CLASS = "border-ink bg-ink text-white shadow-sm";
const INACTIVE_TAB_CLASS =
  "border border-slate-300 bg-white text-slate-700 hover:border-ink hover:text-ink";
const INACTIVE_PILL_CLASS = "border-slate-300 bg-white text-slate-700 hover:border-ink";

function createInitialRunStatus(): RunStatusMap {
  return {
    opendataloader: { state: "idle" },
    upstage: { state: "idle" },
    vision: { state: "idle" },
    postprocess: { state: "idle" },
    pipeline: { state: "idle" },
  };
}

function InputField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className = "", ...rest } = props;
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        {...rest}
        className={`w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal ${className}`}
      />
    </label>
  );
}

function TextareaField(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }
) {
  const { label, className = "", ...rest } = props;
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        {...rest}
        className={`w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal ${className}`}
      />
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-medium transition ${
        checked
          ? ACTIVE_PILL_CLASS
          : INACTIVE_PILL_CLASS
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-white" : "bg-slate-300"}`} />
      {label}
    </button>
  );
}

function InfoTooltip({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Prompt help"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-600 transition hover:border-teal hover:text-teal"
      >
        ?
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-600 shadow-panel">
          {content}
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({
  language,
  status,
}: {
  language: AppLanguage;
  status: RunStatus;
}) {
  const t = (key: string) => translate(language, key);
  const style =
    status.state === "running"
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : status.state === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : status.state === "error"
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-slate-200 bg-white text-slate-500";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${style}`}>
      {status.state === "idle"
        ? t("status.idle")
        : status.state === "running"
          ? t("status.running")
          : status.state === "success"
            ? t("status.success")
            : t("status.error")}
    </span>
  );
}

function getErrorMessage(error: unknown, language: AppLanguage): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as
      | {
          error?: {
            message?: string;
            details?: {
              message?: string;
              hint?: string;
              remoteStatus?: number;
              remoteData?: unknown;
            };
          };
        }
      | undefined;
    const baseMessage = payload?.error?.message || error.message;
    const detailMessage = payload?.error?.details?.message;
    const hintMessage = payload?.error?.details?.hint;
    const remoteStatus = payload?.error?.details?.remoteStatus;
    const remoteData = payload?.error?.details?.remoteData;

    if (remoteStatus && remoteData) {
      const remoteSummary =
        typeof remoteData === "string"
          ? remoteData
          : JSON.stringify(remoteData);
      return hintMessage
        ? `${baseMessage} (upstream ${remoteStatus}: ${remoteSummary}) (${hintMessage})`
        : `${baseMessage} (upstream ${remoteStatus}: ${remoteSummary})`;
    }

    if (remoteStatus) {
      return hintMessage
        ? `${baseMessage} (upstream ${remoteStatus}) (${hintMessage})`
        : `${baseMessage} (upstream ${remoteStatus})`;
    }

    if (detailMessage && detailMessage !== baseMessage) {
      return hintMessage
        ? `${baseMessage} (${detailMessage}) (${hintMessage})`
        : `${baseMessage} (${detailMessage})`;
    }

    if (hintMessage) {
      return `${baseMessage} (${hintMessage})`;
    }

    return baseMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return translate(language, "errors.unknown");
}

function getUploadLibraryErrorMessage(error: unknown, language: AppLanguage): string {
  if (error instanceof Error && error.message === UPLOAD_LIBRARY_LIMIT_ERROR) {
    return translate(language, "alerts.upload_too_large_for_library");
  }

  return translate(language, "alerts.save_upload_failed");
}

function resolveUpstageText(result: StageResponse | null): string {
  if (!result) {
    return "";
  }

  return result.content?.markdown || result.content?.text || result.content?.html || "";
}

function resolveOpendataloaderText(result: StageResponse | null): string {
  if (!result) {
    return "";
  }

  return (
    result.content?.structuredText ||
    result.content?.plainText ||
    result.content?.text ||
    result.text ||
    ""
  );
}

function getSelectedPostprocessSources(
  config: ReturnType<typeof useAppStore.getState>["postprocessConfig"]
) {
  return {
    opendataloader: config.includeOpendataloader,
    upstage: config.includeUpstage,
    vision: config.includeVision,
  };
}

function buildVisionResultTitle(language: AppLanguage, model: VisionModelConfig): string {
  const prefix = translate(language, "results.vision");
  return `${prefix} · ${getVisionModelDisplayLabel(model)}`;
}

function buildVisionResult(
  model: VisionModelConfig,
  result: StageResponse | null,
  errorMessage?: string
): VisionModelResult {
  return {
    ...(result || {}),
    statusCode: result?.statusCode ?? 0,
    modelId: model.id,
    modelLabel: getVisionModelDisplayLabel(model),
    modelUrl: model.url,
    errorMessage,
  };
}

function coerceVisionResult(
  input: unknown,
  model: VisionModelConfig | null | undefined
): VisionModelResult | null {
  if (!model || !input || typeof input !== "object") {
    return null;
  }

  const result = input as StageResponse & { errorMessage?: string };
  return buildVisionResult(model, result, result.errorMessage);
}

function buildBundle(config: {
  opendataloader: ReturnType<typeof useAppStore.getState>["opendataloaderConfig"];
  upstage: ReturnType<typeof useAppStore.getState>["upstageConfig"];
  vision: ReturnType<typeof useAppStore.getState>["visionRegistry"];
  postprocess: ReturnType<typeof useAppStore.getState>["postprocessConfig"];
}): StoredConfigBundle {
  return {
    opendataloader: config.opendataloader,
    upstage: config.upstage,
    vision: config.vision,
    postprocess: config.postprocess,
  };
}

function coerceBundle(input: unknown): StoredConfigBundle | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeBundle = input as Partial<StoredConfigBundle> & { vision?: unknown };
  if (maybeBundle.upstage && maybeBundle.vision && maybeBundle.postprocess) {
    return {
      opendataloader:
        (maybeBundle.opendataloader as StoredConfigBundle["opendataloader"]) ||
        defaults.opendataloader,
      upstage: maybeBundle.upstage as StoredConfigBundle["upstage"],
      vision: normalizeVisionRegistry(maybeBundle.vision),
      postprocess: maybeBundle.postprocess as StoredConfigBundle["postprocess"],
    };
  }

  return null;
}

function coerceStageResult(input: unknown): StageResponse | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  return input as StageResponse;
}

function getStageLabel(language: AppLanguage, stage: StageKey): string {
  const t = (key: string) => translate(language, key);
  switch (stage) {
    case "opendataloader":
      return t("stage.opendataloader");
    case "upstage":
      return t("stage.upstage");
    case "vision":
      return t("stage.vision");
    case "postprocess":
      return t("stage.postprocess");
    case "pipeline":
      return t("stage.pipeline");
    default:
      return stage;
  }
}

function getHistoryRunTypeLabel(language: AppLanguage, runType: string): string {
  const t = (key: string) => translate(language, key);
  switch (runType) {
    case "full_pipeline":
      return t("history.full_pipeline");
    case "opendataloader":
      return t("history.opendataloader");
    case "upstage":
      return t("history.upstage");
    case "vision_llm":
      return t("history.vision_llm");
    case "postprocess":
      return t("history.postprocess");
    default:
      return runType;
  }
}

function formatHistoryMeta(language: AppLanguage, item: HistoryRecord): string {
  const runLabel = getHistoryRunTypeLabel(language, item.runType);
  const dateLabel = isoToLabel(item.createdAt);
  return language === "ko" ? `${runLabel} 실행 · ${dateLabel}` : `${runLabel} at ${dateLabel}`;
}

function createUploadedDocumentId(file: Pick<File, "name" | "size" | "lastModified">): string {
  return [file.name, file.size, file.lastModified].join("::");
}

function mergeServerFileMeta(
  responseFile: FileMeta,
  fallbackFile: Pick<File, "name" | "size" | "type"> | null,
  currentMeta: FileMeta | null
): FileMeta {
  return {
    ...(currentMeta || {
      fileName: fallbackFile?.name || responseFile.fileName,
      fileSize: fallbackFile?.size || responseFile.fileSize,
      mimeType: fallbackFile?.type || responseFile.mimeType,
      pageCount: 1,
    }),
    ...responseFile,
    // Preserve the browser-provided filename for the upload library UI.
    fileName: fallbackFile?.name || currentMeta?.fileName || responseFile.fileName,
  };
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pageCount, 1));
}

function sanitizePageRois(pageRois: PageRoiMap | undefined, pageCount: number): PageRoiMap {
  if (!pageRois) {
    return {};
  }

  return Object.entries(pageRois).reduce((accumulator: PageRoiMap, [pageKey, roi]) => {
    const normalizedPage = Number(pageKey);
    if (!Number.isInteger(normalizedPage) || normalizedPage < 1 || normalizedPage > Math.max(pageCount, 1)) {
      return accumulator;
    }

    accumulator[String(normalizedPage)] = {
      ...roi,
      page: normalizedPage,
    };
    return accumulator;
  }, {});
}

export function DashboardPage() {
  const {
    language,
    setLanguage,
    opendataloaderConfig,
    upstageConfig,
    visionRegistry,
    postprocessConfig,
    fileMeta,
    results,
    presets,
    history,
    updateOpendataloaderConfig,
    updateUpstageConfig,
    setVisionRegistry,
    updateVisionModel,
    addVisionModel,
    cloneVisionModel,
    removeVisionModel,
    setActiveVisionModel,
    updatePostprocessConfig,
    setFileMeta,
    setStageResult,
    setVisionResults,
    resetResults,
    setPresets,
    setHistory,
    applyConfigBundle,
    resetConfigs,
  } = useAppStore();

  const t = (key: string) => translate(language, key);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [endpointCheckResult, setEndpointCheckResult] = useState<unknown>(null);
  const [upstageTestResult, setUpstageTestResult] = useState<unknown>(null);
  const [visionTestResults, setVisionTestResults] = useState<Record<string, unknown>>({});
  const [postprocessTestResult, setPostprocessTestResult] = useState<unknown>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [presetPage, setPresetPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [runStatus, setRunStatus] = useState<RunStatusMap>(createInitialRunStatus());
  const [resultsView, setResultsView] = useState<ResultWorkspaceView>("compare");
  const [compareMode] = useState<CompareWorkspaceMode>("all");
  const [ocrSetupView, setOcrSetupView] = useState<OcrSetupView>("upstage");
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState<WorkspaceMenuKey>("document");
  const [isWorkspaceMenuCollapsed, setIsWorkspaceMenuCollapsed] = useState(false);
  const activeDocument = useMemo(
    () => uploadedDocuments.find((document) => document.id === activeDocumentId) || null,
    [activeDocumentId, uploadedDocuments]
  );
  const selectedFile = activeDocument?.file || null;
  const activeFileMeta = activeDocument?.meta || fileMeta;
  const activeVisionModel = useMemo(
    () =>
      visionRegistry.models.find((model) => model.id === visionRegistry.activeModelId) ||
      visionRegistry.models[0] ||
      null,
    [visionRegistry]
  );
  const visionConfig = activeVisionModel || createVisionModelConfig();
  const activeVisionResult = activeVisionModel ? results.vision[activeVisionModel.id] || null : null;
  const activeVisionTestResult = activeVisionModel
    ? visionTestResults[activeVisionModel.id] || null
    : null;
  const activeVisionDisplayLabel = getVisionModelDisplayLabel(activeVisionModel);

  const currentBundle = useMemo(
    () =>
      buildBundle({
        opendataloader: opendataloaderConfig,
        upstage: upstageConfig,
        vision: visionRegistry,
        postprocess: postprocessConfig,
      }),
    [opendataloaderConfig, postprocessConfig, upstageConfig, visionRegistry]
  );
  const resultsWorkspaceSubtitle =
    language === "ko"
      ? "등록한 Vision 모델 응답을 함께 비교하거나, 단계별 결과를 크게 확인할 수 있습니다."
      : "Compare OpenDataLoader, Upstage, Vision, and postprocess outputs together or open each result in a larger workspace.";
  const workspaceTabs: Array<{ key: ResultWorkspaceView; label: string }> = [
    {
      key: "compare",
      label: language === "ko" ? "비교 화면" : "Compare",
    },
    {
      key: "opendataloader",
      label: t("results.opendataloader"),
    },
    {
      key: "upstage",
      label: t("results.upstage"),
    },
    {
      key: "vision",
      label: t("results.vision"),
    },
    {
      key: "postprocess",
      label: t("results.postprocess"),
    },
    {
      key: "insights",
      label: language === "ko" ? "진단 정보" : "Diagnostics",
    },
  ];
  const resultPaneMap: Record<ResultWorkspaceStage, ResultPaneData> = {
    opendataloader: {
      title: t("results.opendataloader"),
      text: resolveOpendataloaderText(results.opendataloader),
      raw: results.opendataloader?.raw,
      statusCode: results.opendataloader?.statusCode,
      downloads: results.opendataloader?.downloads,
      opendataloaderResult: results.opendataloader,
      errorMessage:
        runStatus.opendataloader.state === "error" ? runStatus.opendataloader.message : undefined,
    },
    upstage: {
      title: t("results.upstage"),
      text: resolveUpstageText(results.upstage),
      raw: results.upstage?.raw,
      statusCode: results.upstage?.statusCode,
      errorMessage: runStatus.upstage.state === "error" ? runStatus.upstage.message : undefined,
    },
    vision: {
      title: activeVisionModel
        ? buildVisionResultTitle(language, activeVisionModel)
        : t("results.vision"),
      text: activeVisionResult?.text || "",
      raw: activeVisionResult?.raw,
      statusCode: activeVisionResult?.statusCode,
      promptPreview: activeVisionResult?.usedPrompt?.compiledPrompt,
      referencePreview: activeVisionResult?.usedReferenceText,
      errorMessage: activeVisionResult?.errorMessage,
    },
    postprocess: {
      title: t("results.postprocess"),
      text: results.postprocess?.text || "",
      raw: results.postprocess?.raw,
      statusCode: results.postprocess?.statusCode,
      promptPreview: results.postprocess?.usedPrompt?.compiledPrompt,
      referencePreview: results.postprocess?.usedReferenceText,
      errorMessage:
        runStatus.postprocess.state === "error" ? runStatus.postprocess.message : undefined,
    },
  };
  /*
  const compareModeTabs: Array<{ key: CompareWorkspaceMode; label: string }> = [
    {
      key: "upstage_vision",
      label: `${t("results.upstage")} vs ${t("results.vision")}`,
    },
    {
      key: "vision_postprocess",
      label: `${t("results.vision")} vs ${t("results.postprocess")}`,
    },
    {
      key: "upstage_postprocess",
      label: `${t("results.upstage")} vs ${t("results.postprocess")}`,
    },
    {
      key: "all",
      label: language === "ko" ? "전체 3종" : "All Three",
    },
  ];
  const comparePaneKeys: ResultWorkspaceStage[] =
    compareMode === "upstage_vision"
      ? ["upstage", "vision"]
      : compareMode === "vision_postprocess"
        ? ["vision", "postprocess"]
        : compareMode === "upstage_postprocess"
          ? ["upstage", "postprocess"]
          : ["upstage", "vision", "postprocess"];
  */
  const visionPaneEntries = visionRegistry.models.map((model) => {
    const result = results.vision[model.id] || null;
    return {
      model,
      pane: {
        title: buildVisionResultTitle(language, model),
        text: result?.text || "",
        raw: result?.raw,
        statusCode: result?.statusCode,
        promptPreview: result?.usedPrompt?.compiledPrompt,
        referencePreview: result?.usedReferenceText,
        errorMessage: result?.errorMessage,
      } satisfies ResultPaneData,
    };
  });
  const comparePanes: ResultPaneData[] = [
    resultPaneMap.opendataloader,
    resultPaneMap.upstage,
    ...visionPaneEntries.map((entry) => entry.pane),
    resultPaneMap.postprocess,
  ];
  const ocrSetupTabs: Array<{ key: OcrSetupView; label: string }> = [
    {
      key: "opendataloader",
      label: t("section.opendataloader.title"),
    },
    {
      key: "upstage",
      label: t("section.upstage.title"),
    },
    {
      key: "vision",
      label: t("section.vision.title"),
    },
    {
      key: "postprocess",
      label: t("section.postprocess.title"),
    },
  ];
  const focusedPaneKey: ResultWorkspaceStage | null =
    resultsView === "opendataloader" || resultsView === "upstage" || resultsView === "postprocess"
      ? resultsView
      : null;
  const focusedPane = focusedPaneKey ? resultPaneMap[focusedPaneKey] : null;
  const renderWorkspacePane = (
    pane: ResultPaneData,
    options?: {
      key?: string;
      className?: string;
      textareaClassName?: string;
      contentClassName?: string;
    }
  ) => {
    if (pane.opendataloaderResult) {
      return (
        <OpendataloaderResultPane
          key={options?.key || pane.title}
          title={pane.title}
          result={pane.opendataloaderResult}
          statusCode={pane.statusCode}
          downloads={pane.downloads}
          errorMessage={pane.errorMessage}
          className={options?.className}
          textareaClassName={options?.textareaClassName}
          contentClassName={options?.contentClassName}
        />
      );
    }

    return (
      <ResultPane
        key={options?.key || pane.title}
        title={pane.title}
        text={pane.text}
        raw={pane.raw}
        statusCode={pane.statusCode}
        promptPreview={pane.promptPreview}
        referencePreview={pane.referencePreview}
        downloads={pane.downloads}
        errorMessage={pane.errorMessage}
        className={options?.className}
        textareaClassName={options?.textareaClassName}
        contentClassName={options?.contentClassName}
      />
    );
  };
  const workspaceMenuItems: Array<{
    key: WorkspaceMenuKey;
    step: string;
    label: string;
    description: string;
  }> = [
    {
      key: "document",
      step: "01",
      label: t("section.file.title"),
      description:
        activeFileMeta?.fileName ||
        (language === "ko" ? "업로드 파일과 미리보기를 관리합니다." : "Manage uploads and previews."),
    },
    {
      key: "ocr_setup",
      step: "02",
      label: language === "ko" ? "OCR 설정" : "OCR Setup",
      description:
        language === "ko"
          ? "Upstage, Vision, ROI, Postprocess를 한 흐름으로 조정합니다."
          : "Tune OpenDataLoader, Upstage, Vision, ROI, and postprocess in one workflow.",
    },
    {
      key: "run_center",
      step: "03",
      label: t("section.run_controls.title"),
      description:
        language === "ko"
          ? "단계별 실행과 상태를 확인합니다."
          : "Run each stage and monitor status.",
    },
    {
      key: "results",
      step: "04",
      label: t("section.results.title"),
      description:
        language === "ko"
          ? "결과 비교와 원본 응답 확인 화면입니다."
          : "Open the comparison workspace and raw outputs.",
    },
    {
      key: "library",
      step: "05",
      label: language === "ko" ? "프리셋 & 히스토리" : "Presets & History",
      description:
        language === "ko"
          ? `프리셋 ${presets.length}개 · 히스토리 ${history.length}건`
          : `${presets.length} presets · ${history.length} history items`,
    },
  ];
  const totalPresetPages = Math.max(1, Math.ceil(presets.length / PRESETS_PER_PAGE));
  const visiblePresets = useMemo(() => {
    const start = (presetPage - 1) * PRESETS_PER_PAGE;
    return presets.slice(start, start + PRESETS_PER_PAGE);
  }, [presetPage, presets]);
  const totalHistoryPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
  const visibleHistory = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PER_PAGE;
    return history.slice(start, start + HISTORY_PER_PAGE);
  }, [history, historyPage]);

  const roiEnabled =
    visionConfig.rangeMode === "roi" || visionConfig.rangeMode === "page_and_roi";
  const activePageCount = Math.max(activeFileMeta?.pageCount || 1, 1);
  const activeVisionRoi = useMemo(() => {
    if (visionConfig.rangeMode !== "page_and_roi") {
      return {
        ...visionConfig.roi,
        page: clampPage(visionConfig.roi.page || 1, activePageCount),
      };
    }

    const pageSpecificRoi = visionConfig.pageRois?.[String(previewPage)];
    if (pageSpecificRoi) {
      return pageSpecificRoi;
    }

    return {
      ...visionConfig.roi,
      page: clampPage(previewPage, activePageCount),
    };
  }, [activePageCount, previewPage, visionConfig.pageRois, visionConfig.rangeMode, visionConfig.roi]);

  useEffect(() => {
    void refreshSidebarData();
    void restoreUploadedDocuments();
  }, []);

  useEffect(() => {
    setPresetPage((current) => Math.min(current, totalPresetPages));
  }, [totalPresetPages]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, totalHistoryPages));
  }, [totalHistoryPages]);

  useEffect(() => {
    setPreviewPage((current) => clampPage(current, activePageCount));
  }, [activePageCount]);

  async function refreshSidebarData() {
    const [historyItems, presetItems] = await Promise.all([
      fetchHistoryApi(),
      fetchPresetsApi(),
    ]);

    setHistory(historyItems);
    setPresets(presetItems);
  }

  async function restoreUploadedDocuments() {
    try {
      const snapshot = await loadUploadLibrary();
      setUploadedDocuments(snapshot.documents);

      if (!snapshot.activeDocumentId) {
        return;
      }

      const document = snapshot.documents.find((item) => item.id === snapshot.activeDocumentId);
      if (!document) {
        return;
      }

      activateUploadedDocument(document, {
        persistSelection: false,
        resetResults: false,
        visionScopeMode: "clamp",
      });
    } catch {
      alert(t("alerts.restore_uploads_failed"));
    }
  }

  function updateActiveVisionConfig(patch: Partial<VisionModelConfig>) {
    if (!activeVisionModel) {
      return;
    }

    updateVisionModel(activeVisionModel.id, patch);
  }

  function handleSelectVisionModel(modelId: string) {
    const model = visionRegistry.models.find((entry) => entry.id === modelId);
    if (!model) {
      return;
    }

    setActiveVisionModel(model.id);
    setPreviewPage(clampPage(model.roi.page || model.pageRangeStart || 1, activePageCount));
  }

  function handleAddVisionModel() {
    addVisionModel();
    setPreviewPage(1);
  }

  function handleCloneActiveVisionModel() {
    if (!activeVisionModel) {
      return;
    }

    cloneVisionModel(activeVisionModel.id);
    setPreviewPage(clampPage(activeVisionModel.roi.page || activeVisionModel.pageRangeStart || 1, activePageCount));
  }

  function handleRemoveActiveVisionModel() {
    if (!activeVisionModel || visionRegistry.models.length <= 1) {
      return;
    }

    setPreviewPage(1);
    setVisionTestResults((current) => {
      const next = { ...current };
      delete next[activeVisionModel.id];
      return next;
    });
    removeVisionModel(activeVisionModel.id);
  }

  function syncVisionScopeWithFileMeta(meta: FileMeta, mode: "reset" | "clamp") {
    const totalPages = Math.max(meta.pageCount, 1);
    setVisionRegistry({
      ...visionRegistry,
      models: visionRegistry.models.map((model) => {
        const nextPageRangeStart =
          mode === "reset"
            ? 1
            : Math.min(Math.max(model.pageRangeStart || 1, 1), totalPages);
        const nextPageRangeEnd =
          mode === "reset"
            ? meta.pageCount
            : Math.min(
                Math.max(model.pageRangeEnd || nextPageRangeStart, nextPageRangeStart),
                totalPages
              );
        const nextRoiPage = mode === "reset" ? 1 : clampPage(model.roi.page || 1, totalPages);
        const nextPageRois =
          mode === "reset" ? {} : sanitizePageRois(model.pageRois, totalPages);

        return {
          ...model,
          pageRangeStart: nextPageRangeStart,
          pageRangeEnd: nextPageRangeEnd,
          roi: {
            ...model.roi,
            page: nextRoiPage,
          },
          pageRois: nextPageRois,
        };
      }),
    });
  }

  function updateUploadedDocumentMeta(documentId: string, nextMeta: FileMeta) {
    setUploadedDocuments((current) =>
      current.map((document) =>
        document.id === documentId
          ? {
              ...document,
              meta: {
                ...document.meta,
                ...nextMeta,
              },
            }
          : document
      )
    );
  }

  function activateUploadedDocument(
    document: UploadedDocument,
    options?: {
      persistSelection?: boolean;
      resetResults?: boolean;
      visionScopeMode?: "reset" | "clamp";
    }
  ) {
    const {
      persistSelection = true,
      resetResults: shouldResetResults = true,
      visionScopeMode = "reset",
    } = options || {};

    setActiveDocumentId(document.id);
    setFileMeta(document.meta);
    if (shouldResetResults) {
      resetResults();
      setRunStatus(createInitialRunStatus());
    }
    setPreviewPage(1);
    syncVisionScopeWithFileMeta(document.meta, visionScopeMode);

    if (persistSelection) {
      void setActiveUploadLibraryDocument(document.id);
    }
  }

  async function handleFileSelection(file: File | null) {
    if (!file) {
      return;
    }

    if (!getSupportedFileKind(file)) {
      alert(t("alerts.unsupported_file"));
      return;
    }

    try {
      const meta = await getLocalFileMeta(file);
      const nextDocument = {
        id: createUploadedDocumentId(file),
        file,
        meta,
      };

      try {
        const snapshot = await saveUploadedDocumentToLibrary(nextDocument);
        setUploadedDocuments(snapshot.documents);
        activateUploadedDocument(nextDocument, {
          persistSelection: false,
          resetResults: true,
          visionScopeMode: "reset",
        });
      } catch (storageError) {
        alert(getUploadLibraryErrorMessage(storageError, language));
      }
    } catch (error) {
      alert(getErrorMessage(error, language));
    }
  }

  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    await handleFileSelection(file);
    event.target.value = "";
  }

  async function handleSelectUploadedDocument(documentId: string) {
    if (documentId === activeDocumentId) {
      return;
    }

    const document = uploadedDocuments.find((item) => item.id === documentId);
    if (!document) {
      return;
    }

    activateUploadedDocument(document, {
      persistSelection: false,
      resetResults: true,
      visionScopeMode: "reset",
    });

    try {
      await setActiveUploadLibraryDocument(document.id);
    } catch {
      alert(t("alerts.save_upload_failed"));
    }
  }

  async function handleDeleteUploadedDocument(documentId: string) {
    const remainingDocuments = uploadedDocuments.filter((document) => document.id !== documentId);
    const nextActiveDocument =
      activeDocumentId === documentId ? remainingDocuments[0] || null : activeDocument;

    setUploadedDocuments(remainingDocuments);

    if (activeDocumentId === documentId) {
      if (nextActiveDocument) {
        activateUploadedDocument(nextActiveDocument, {
          persistSelection: false,
          resetResults: true,
          visionScopeMode: "reset",
        });
      } else {
        setActiveDocumentId(null);
        setFileMeta(null);
        resetResults();
        setRunStatus(createInitialRunStatus());
        setPreviewPage(1);
      }
    }

    try {
      await deleteUploadedDocumentFromLibrary(documentId);
      if (activeDocumentId === documentId) {
        await setActiveUploadLibraryDocument(nextActiveDocument?.id || null);
      }
    } catch {
      alert(t("alerts.save_upload_failed"));
      void restoreUploadedDocuments();
    }
  }

  function markStage(stage: StageKey, next: RunStatus) {
    setRunStatus((current) => ({
      ...current,
      [stage]: next,
    }));
  }

  async function executeStage(stage: StageKey, runner: () => Promise<void>) {
    markStage(stage, { state: "running" });
    try {
      await runner();
      markStage(stage, { state: "success" });
      await refreshSidebarData();
    } catch (error) {
      markStage(stage, { state: "error", message: getErrorMessage(error, language) });
    }
  }

  async function handleRunUpstage() {
    if (!selectedFile) {
      alert(t("alerts.upload_file_first"));
      return;
    }

    await executeStage("upstage", async () => {
      const response = await runUpstageApi(selectedFile, upstageConfig);
      setStageResult("upstage", response);
      if (response.file) {
        const nextMeta = mergeServerFileMeta(response.file, selectedFile, activeFileMeta);
        setFileMeta(nextMeta);
        if (activeDocumentId) {
          updateUploadedDocumentMeta(activeDocumentId, nextMeta);
        }
      }
    });
  }

  async function handleRunOpenDataLoader() {
    if (!selectedFile || !activeFileMeta) {
      alert(t("alerts.upload_file_first"));
      return;
    }

    if (activeFileMeta.mimeType !== "application/pdf") {
      alert(t("alerts.opendataloader_pdf_only"));
      return;
    }

    await executeStage("opendataloader", async () => {
      const response = await runOpenDataLoaderApi(selectedFile, opendataloaderConfig);
      setStageResult("opendataloader", response);
      if (response.file) {
        const nextMeta = mergeServerFileMeta(response.file, selectedFile, activeFileMeta);
        setFileMeta(nextMeta);
        if (activeDocumentId) {
          updateUploadedDocumentMeta(activeDocumentId, nextMeta);
        }
      }
    });
  }

  async function handleRunVision() {
    if (!selectedFile) {
      alert(t("alerts.upload_file_first"));
      return;
    }

    await executeStage("vision", async () => {
      const executions = await Promise.allSettled(
        visionRegistry.models.map(async (model) => {
          const response = await runVisionApi(selectedFile, model);
          return {
            model,
            response,
          };
        })
      );

      const nextVisionResults: Record<string, VisionModelResult | null> = {};
      const failedMessages: string[] = [];
      let nextMeta: FileMeta | null = null;

      executions.forEach((execution, index) => {
        const model = visionRegistry.models[index];
        if (!model) {
          return;
        }

        if (execution.status === "fulfilled") {
          nextVisionResults[model.id] = buildVisionResult(model, execution.value.response);
          if (execution.value.response.file) {
            nextMeta = mergeServerFileMeta(
              execution.value.response.file,
              selectedFile,
              nextMeta || activeFileMeta
            );
          }
          return;
        }

        const errorMessage = getErrorMessage(execution.reason, language);
        nextVisionResults[model.id] = buildVisionResult(model, null, errorMessage);
        failedMessages.push(`${getVisionModelDisplayLabel(model)}: ${errorMessage}`);
      });

      setVisionResults(nextVisionResults);

      if (nextMeta) {
        setFileMeta(nextMeta);
        if (activeDocumentId) {
          updateUploadedDocumentMeta(activeDocumentId, nextMeta);
        }
      }

      if (failedMessages.length > 0) {
        await refreshSidebarData();
        throw new Error(failedMessages.join(" | "));
      }
    });
  }

  async function handleRunPostprocess() {
    const selectedSources = getSelectedPostprocessSources(postprocessConfig);
    const opendataloaderResult = results.opendataloader;
    const upstageResult = results.upstage;
    const visionResult = activeVisionResult;

    if (!activeFileMeta) {
      alert(t("alerts.upload_file_first"));
      return;
    }

    if (!selectedSources.opendataloader && !selectedSources.upstage && !selectedSources.vision) {
      alert(t("alerts.select_postprocess_source_first"));
      return;
    }

    if (
      (selectedSources.opendataloader && !opendataloaderResult) ||
      (selectedSources.upstage && !upstageResult) ||
      (selectedSources.vision && (!visionResult || visionResult.errorMessage))
    ) {
      alert(t("alerts.run_selected_ocr_first"));
      return;
    }

    await executeStage("postprocess", async () => {
      const response = await runPostprocessApi({
        file: activeFileMeta,
        opendataloaderResult,
        upstageResult,
        visionResult,
        config: postprocessConfig,
      });
      setStageResult("postprocess", response);
    });
  }

  async function handleRunAll() {
    if (!selectedFile) {
      alert(t("alerts.upload_file_first"));
      return;
    }

    if (!postprocessConfig.url || !postprocessConfig.model) {
      alert(
        language === "ko"
          ? "전체 파이프라인 실행에는 Postprocess LLM URL과 모델이 필요합니다."
          : "Full pipeline requires the postprocess URL and model."
      );
      return;
    }

    const selectedSources = getSelectedPostprocessSources(postprocessConfig);

    if (!selectedSources.opendataloader && !selectedSources.upstage && !selectedSources.vision) {
      alert(t("alerts.select_postprocess_source_first"));
      return;
    }

    if ((activeFileMeta?.mimeType || selectedFile.type) !== "application/pdf" && selectedSources.opendataloader) {
      alert(t("alerts.opendataloader_pdf_only"));
      return;
    }

    await executeStage("pipeline", async () => {
      const response = await runAllApi(selectedFile, currentBundle);
      const nextMeta = mergeServerFileMeta(response.file, selectedFile, activeFileMeta);
      setFileMeta(nextMeta);
      if (activeDocumentId) {
        updateUploadedDocumentMeta(activeDocumentId, nextMeta);
      }
      setStageResult("opendataloader", response.opendataloader);
      setStageResult("upstage", response.upstage);
      if (activeVisionModel && response.vision) {
        setVisionResults({
          [activeVisionModel.id]: buildVisionResult(activeVisionModel, response.vision),
        });
      } else {
        setVisionResults({});
      }
      setStageResult("postprocess", response.postprocess);
      markStage("opendataloader", response.opendataloader ? { state: "success" } : { state: "idle" });
      markStage("upstage", response.upstage ? { state: "success" } : { state: "idle" });
      markStage("vision", response.vision ? { state: "success" } : { state: "idle" });
      markStage("postprocess", { state: "success" });
    });
  }

  async function handleCheckEndpoints() {
    if (!upstageConfig.endpointsUrl) {
      alert(t("alerts.enter_endpoint_check_url"));
      return;
    }

    try {
      const response = await checkUpstageEndpointsApi({
        url: upstageConfig.endpointsUrl,
        headersJson: upstageConfig.headersJson,
        timeoutMs: upstageConfig.timeoutMs,
        retryCount: upstageConfig.retryCount,
      });
      setEndpointCheckResult(response);
    } catch (error) {
      setEndpointCheckResult({ error: getErrorMessage(error, language) });
    }
  }

  async function handleTestUpstageCall() {
    try {
      const response = await testUpstageCallApi(upstageConfig);
      setUpstageTestResult(response);
    } catch (error) {
      setUpstageTestResult({ error: getErrorMessage(error, language) });
    }
  }

  async function handleTestVisionCall() {
    if (!activeVisionModel) {
      return;
    }

    try {
      const response = await testVisionCallApi(visionConfig);
      setVisionTestResults((current) => ({
        ...current,
        [activeVisionModel.id]: response,
      }));
    } catch (error) {
      setVisionTestResults((current) => ({
        ...current,
        [activeVisionModel.id]: { error: getErrorMessage(error, language) },
      }));
    }
  }

  async function handleTestPostprocessCall() {
    try {
      const response = await testPostprocessCallApi({
        config: postprocessConfig,
      });
      setPostprocessTestResult(response);
    } catch (error) {
      setPostprocessTestResult({ error: getErrorMessage(error, language) });
    }
  }

  async function handleReferenceUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    target: "vision" | "postprocess"
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await readTextFile(file);
    if (target === "vision") {
      updateActiveVisionConfig({ referenceText: text, referenceEnabled: true });
    } else {
      updatePostprocessConfig({ referenceText: text, referenceEnabled: true });
    }
  }

  async function handleSavePreset() {
    if (!presetName.trim()) {
      alert(t("alerts.enter_preset_name"));
      return;
    }

    await createPresetApi({
      name: presetName.trim(),
      description: presetDescription.trim(),
      config: currentBundle,
    });
    setPresetName("");
    setPresetDescription("");
    setPresetPage(1);
    await refreshSidebarData();
  }

  async function handleUpdatePreset(preset: PresetRecord) {
    await updatePresetApi(preset.id, {
      name: preset.name,
      description: preset.description,
      config: currentBundle,
    });
    setPresetPage(1);
    await refreshSidebarData();
  }

  async function handleDeletePreset(id: number) {
    await deletePresetApi(id);
    await refreshSidebarData();
  }

  async function handleDeleteHistory(id: number) {
    await deleteHistoryApi(id);
    await refreshSidebarData();
  }

  function handleLoadPreset(preset: PresetRecord) {
    applyConfigBundle(preset.config);
  }

  function handleLoadHistory(item: HistoryRecord) {
    setActiveDocumentId(null);
    setPreviewPage(1);
    setFileMeta(null);
    resetResults();
    setVisionTestResults({});

    let nextVisionRegistry: VisionRegistry | null = null;
    const bundle = coerceBundle(item.config);
    if (bundle) {
      nextVisionRegistry = bundle.vision;
      applyConfigBundle(bundle);
    } else if (item.runType === "opendataloader") {
      updateOpendataloaderConfig(item.config as Partial<typeof opendataloaderConfig>);
    } else if (item.runType === "upstage") {
      updateUpstageConfig(item.config as Partial<typeof upstageConfig>);
    } else if (item.runType === "vision_llm") {
      nextVisionRegistry = normalizeVisionRegistry(item.config);
      setVisionRegistry(nextVisionRegistry);
    } else if (item.runType === "postprocess") {
      updatePostprocessConfig(item.config as Partial<typeof postprocessConfig>);
    }

    const result = item.result as Record<string, unknown>;
    const nextRunStatus = createInitialRunStatus();
    if (item.runType === "full_pipeline") {
      const pipelineOpenDataLoaderResult = coerceStageResult(result.opendataloader);
      setStageResult("opendataloader", pipelineOpenDataLoaderResult);
      setStageResult("upstage", coerceStageResult(result.upstage));
      const pipelineVisionRegistry = nextVisionRegistry || visionRegistry;
      const pipelineVisionModel =
        pipelineVisionRegistry.models.find(
          (model) => model.id === pipelineVisionRegistry.activeModelId
        ) || pipelineVisionRegistry.models[0];
      const pipelineVisionResult = coerceStageResult(result.vision);
      if (pipelineVisionModel && pipelineVisionResult) {
        setVisionResults({
          [pipelineVisionModel.id]: buildVisionResult(pipelineVisionModel, pipelineVisionResult),
        });
      } else {
        setVisionResults({});
      }
      setStageResult("postprocess", coerceStageResult(result.postprocess));
      if (pipelineOpenDataLoaderResult) {
        nextRunStatus.opendataloader = { state: "success" };
      }
      if (result.upstage) {
        nextRunStatus.upstage = { state: "success" };
      }
      if (pipelineVisionResult) {
        nextRunStatus.vision = { state: "success" };
      }
      nextRunStatus.postprocess = { state: "success" };
      nextRunStatus.pipeline = { state: "success" };
    } else if (item.runType === "opendataloader") {
      setStageResult("opendataloader", coerceStageResult(item.result));
      nextRunStatus.opendataloader = { state: "success" };
    } else if (item.runType === "upstage") {
      setStageResult("upstage", coerceStageResult(item.result));
      nextRunStatus.upstage = { state: "success" };
    } else if (item.runType === "vision_llm") {
      const singleVisionRegistry = nextVisionRegistry || normalizeVisionRegistry(item.config);
      const singleVisionModel =
        singleVisionRegistry.models.find((model) => model.id === singleVisionRegistry.activeModelId) ||
        singleVisionRegistry.models[0];
      const singleVisionResult = coerceVisionResult(item.result, singleVisionModel);
      if (singleVisionModel && singleVisionResult) {
        setVisionResults({
          [singleVisionModel.id]: singleVisionResult,
        });
      }
      nextRunStatus.vision = { state: "success" };
    } else if (item.runType === "postprocess") {
      setStageResult("postprocess", coerceStageResult(item.result));
      nextRunStatus.postprocess = { state: "success" };
    }
    setRunStatus(nextRunStatus);

    if (item.fileName && item.mimeType && item.fileSize) {
      setFileMeta({
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        pageCount: item.filePages || 1,
        fileHash: item.fileHash || null,
      });
    }
  }

  function handlePreviewRoiPageChange(nextPage: number) {
    const clampedPage = clampPage(nextPage, activePageCount);
    setPreviewPage(clampedPage);

    if (visionConfig.rangeMode === "roi") {
      updateActiveVisionConfig({
        roi: {
          ...visionConfig.roi,
          page: clampedPage,
        },
      });
    }
  }

  function updateRoi(patch: Partial<Roi>) {
    if (visionConfig.rangeMode === "page_and_roi") {
      const targetPage = clampPage(previewPage, activePageCount);
      updateActiveVisionConfig({
        pageRois: {
          ...(visionConfig.pageRois || {}),
          [String(targetPage)]: {
            ...activeVisionRoi,
            ...patch,
            page: targetPage,
          },
        },
      });
      return;
    }

    updateActiveVisionConfig({
      roi: {
        ...visionConfig.roi,
        ...patch,
        page: clampPage(Number(patch.page ?? visionConfig.roi.page ?? 1), activePageCount),
      },
    });
  }

  function setRangeMode(mode: RangeMode) {
    updateActiveVisionConfig({ rangeMode: mode });
  }

  function handleWorkspaceMenuSelect(section: WorkspaceMenuKey) {
    setActiveWorkspaceSection(section);

    if (typeof window !== "undefined") {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  }

  function resetDashboardState() {
    resetConfigs();
    resetResults();
    setEndpointCheckResult(null);
    setUpstageTestResult(null);
    setVisionTestResults({});
    setPostprocessTestResult(null);
    setRunStatus(createInitialRunStatus());
  }

  const stageActions: [StageKey, () => Promise<void>, string][] = [
    ["opendataloader", handleRunOpenDataLoader, t("button.run_opendataloader")],
    ["upstage", handleRunUpstage, t("button.run_upstage")],
    ["vision", handleRunVision, t("button.run_vision")],
    ["postprocess", handleRunPostprocess, t("button.run_postprocess")],
    ["pipeline", handleRunAll, t("button.run_full_pipeline")],
  ];

  const rangeModes: [RangeMode, string][] = [
    ["full_document", t("scope.full_document")],
    ["page_range", t("scope.page_range")],
    ["roi", t("scope.roi_only")],
    ["page_and_roi", t("scope.page_and_roi")],
  ];

  const leftColumn = (
    <div className="space-y-6">
      <div
        id="workspace-document"
        className={activeWorkspaceSection === "document" ? "block" : "hidden"}
      >
        <SectionCard title={t("section.file.title")} subtitle={t("section.file.subtitle")}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-teal hover:bg-white">
          <span className="text-base font-medium text-ink">{t("section.file.select")}</span>
          <span className="mt-2 text-sm text-slate-500">{t("section.file.supported")}</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(event) => void handleFileInputChange(event)}
          />
        </label>

        {activeFileMeta ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              [t("section.meta.file"), activeFileMeta.fileName],
              [t("section.meta.size"), formatBytes(activeFileMeta.fileSize)],
              [t("section.meta.mime"), activeFileMeta.mimeType],
              [t("section.meta.pages"), String(activeFileMeta.pageCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
                <p className="mt-2 break-all text-sm font-medium text-ink">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">{t("section.file.library_title")}</p>
              <p className="mt-1 text-sm text-slate-500">{t("section.file.library_subtitle")}</p>
            </div>
            {activeDocument ? (
              <span className="inline-flex rounded-full border border-teal/20 bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
                {t("section.file.active_target")}: {activeDocument.meta.fileName}
              </span>
            ) : null}
          </div>

          {uploadedDocuments.length === 0 ? (
            <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
              {t("section.file.library_empty")}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {uploadedDocuments.map((document) => {
                const isActive = document.id === activeDocumentId;
                return (
                  <div
                    key={document.id}
                    className={`flex w-full items-start justify-between gap-4 rounded-[24px] border px-4 py-4 text-left transition ${
                      isActive
                        ? "border-teal bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-teal/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelectUploadedDocument(document.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-ink">
                        {document.meta.fileName}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatBytes(document.meta.fileSize)} · {document.meta.mimeType} ·{" "}
                        {t("section.meta.pages")} {document.meta.pageCount}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          isActive
                            ? ACTIVE_TAB_CLASS
                            : "border border-slate-200 bg-slate-50 text-slate-600"
                        }`}
                      >
                        {isActive ? t("section.file.active_badge") : t("button.load")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteUploadedDocument(document.id)}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        {t("button.delete")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DocumentPreview
          file={selectedFile}
          pageCount={activeFileMeta?.pageCount || 1}
          maxPages={3}
          emptyMessage={
            uploadedDocuments.length > 0 && !selectedFile
              ? t("section.file.choose_from_library")
              : undefined
          }
        />
        </SectionCard>
      </div>

      <div
        id="workspace-ocr_setup"
        className={activeWorkspaceSection === "ocr_setup" ? "space-y-6" : "hidden"}
      >
        <SectionCard
          title={language === "ko" ? "OCR 설정" : "OCR Setup"}
          subtitle={
            language === "ko"
              ? "Upstage, Vision, Postprocess 설정을 탭으로 전환하면서 조정합니다."
              : "Switch between OpenDataLoader, Upstage, Vision, and Postprocess settings with tabs."
          }
        >
          <div className="flex flex-wrap gap-3">
            {ocrSetupTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setOcrSetupView(tab.key)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  ocrSetupView === tab.key
                    ? ACTIVE_TAB_CLASS
                    : INACTIVE_TAB_CLASS
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </SectionCard>

        {ocrSetupView === "opendataloader" ? (
        <SectionCard
          title={t("section.opendataloader.title")}
          subtitle={t("section.opendataloader.subtitle")}
        >
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
            {t("opendataloader.note")}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{t("field.output_formats")}</p>
            <div className="flex flex-wrap gap-3">
              {(["json", "markdown", "html", "text"] as const).map((format) => {
                const active = opendataloaderConfig.outputFormats.includes(format);
                return (
                  <button
                    key={format}
                    type="button"
                    onClick={() =>
                      updateOpendataloaderConfig({
                        outputFormats: active
                          ? opendataloaderConfig.outputFormats.filter((item) => item !== format)
                          : [...opendataloaderConfig.outputFormats, format],
                      })
                    }
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      active ? ACTIVE_PILL_CLASS : INACTIVE_PILL_CLASS
                    }`}
                  >
                    {format}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Toggle
              checked={opendataloaderConfig.keepLineBreaks}
              onChange={(checked) => updateOpendataloaderConfig({ keepLineBreaks: checked })}
              label={t("toggle.keep_line_breaks")}
            />
            <Toggle
              checked={opendataloaderConfig.useStructTree}
              onChange={(checked) => updateOpendataloaderConfig({ useStructTree: checked })}
              label={t("toggle.use_struct_tree")}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label={t("field.content_safety_off")}
              value={opendataloaderConfig.contentSafetyOff}
              onChange={(event) =>
                updateOpendataloaderConfig({ contentSafetyOff: event.target.value })
              }
              placeholder="hidden-text,off-page"
            />
            <InputField
              label={t("field.replace_invalid_chars")}
              value={opendataloaderConfig.replaceInvalidChars}
              onChange={(event) =>
                updateOpendataloaderConfig({ replaceInvalidChars: event.target.value })
              }
              placeholder={t("common.optional")}
            />
          </div>
        </SectionCard>
        ) : null}

        {ocrSetupView === "upstage" ? (
        <SectionCard title={t("section.upstage.title")} subtitle={t("section.upstage.subtitle")}>
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label={t("field.dp_url")}
            value={upstageConfig.url}
            onChange={(event) => updateUpstageConfig({ url: event.target.value })}
            placeholder="http://dp-server:8080/v1/document-parse"
          />
          <InputField
            label={t("field.endpoint_check_url")}
            value={upstageConfig.endpointsUrl}
            onChange={(event) => updateUpstageConfig({ endpointsUrl: event.target.value })}
            placeholder="http://dp-server:8080/api/endpoints"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">{t("field.ocr_mode")}</span>
            <select
              value={upstageConfig.ocrMode}
              onChange={(event) =>
                updateUpstageConfig({ ocrMode: event.target.value as "auto" | "force" })
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal"
            >
              <option value="auto">auto</option>
              <option value="force">force</option>
            </select>
          </label>
          <InputField
            label={t("field.model")}
            value={upstageConfig.model}
            onChange={(event) => updateUpstageConfig({ model: event.target.value })}
          />
          <InputField
            label={t("field.timeout_ms")}
            type="number"
            value={String(upstageConfig.timeoutMs)}
            onChange={(event) =>
              updateUpstageConfig({ timeoutMs: Number(event.target.value || 0) })
            }
          />
          <InputField
            label={t("field.retry_count")}
            type="number"
            value={String(upstageConfig.retryCount)}
            onChange={(event) =>
              updateUpstageConfig({ retryCount: Number(event.target.value || 0) })
            }
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Toggle
            checked={upstageConfig.coordinates}
            onChange={(checked) => updateUpstageConfig({ coordinates: checked })}
            label={t("toggle.include_coordinates")}
          />
          <Toggle
            checked={upstageConfig.base64Encoding}
            onChange={(checked) => updateUpstageConfig({ base64Encoding: checked })}
            label={t("toggle.base64_encoding")}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("field.output_formats")}</p>
          <div className="flex flex-wrap gap-3">
            {["text", "html", "markdown"].map((format) => {
              const active = upstageConfig.outputFormats.includes(format);
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() =>
                    updateUpstageConfig({
                      outputFormats: active
                        ? upstageConfig.outputFormats.filter((item) => item !== format)
                        : [...upstageConfig.outputFormats, format],
                    })
                  }
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    active
                      ? ACTIVE_PILL_CLASS
                      : INACTIVE_PILL_CLASS
                  }`}
                >
                  {format}
                </button>
              );
            })}
          </div>
        </div>

        <TextareaField
          label={t("field.extra_headers_json")}
          value={upstageConfig.headersJson}
          onChange={(event) => updateUpstageConfig({ headersJson: event.target.value })}
          className="min-h-28 font-mono"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
            onClick={() => void handleCheckEndpoints()}
          >
            {t("button.check_endpoints")}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => void handleTestUpstageCall()}
          >
            {t("button.check_connection")}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t("json.connection_note")}</p>

        {endpointCheckResult ? (
          <JsonViewer label={t("json.endpoint_check")} data={endpointCheckResult} />
        ) : null}
        {upstageTestResult ? (
          <JsonViewer label={t("json.upstage_test")} data={upstageTestResult} />
        ) : null}
      </SectionCard>
        ) : null}

        {ocrSetupView === "vision" ? (
          <>
      <SectionCard title={t("section.vision.title")} subtitle={t("section.vision.subtitle")}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              {language === "ko" ? "모델 등록" : "Model Registry"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {language === "ko"
                ? "탭마다 독립된 Vision URL과 모델을 등록합니다. Vision OCR 실행 시 모든 등록 탭이 각각 응답을 반환합니다."
                : "Each tab stores an independent Vision URL and model. Running Vision OCR executes every registered tab separately."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAddVisionModel}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              {language === "ko" ? "+ 모델 추가" : "+ Add Model"}
            </button>
            <button
              type="button"
              onClick={handleCloneActiveVisionModel}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-ink hover:text-ink"
            >
              {language === "ko" ? "현재 탭 복제" : "Clone Current"}
            </button>
            {visionRegistry.models.length > 1 ? (
              <button
                type="button"
                onClick={handleRemoveActiveVisionModel}
                className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                {language === "ko" ? "현재 탭 삭제" : "Remove Current"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {visionRegistry.models.map((model, index) => {
            const active = activeVisionModel?.id === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleSelectVisionModel(model.id)}
                className={`rounded-[22px] border px-4 py-3 text-left transition ${
                  active
                    ? `${ACTIVE_TAB_CLASS} border border-ink`
                    : "border border-slate-300 bg-white text-slate-700 hover:border-ink hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {getVisionModelDisplayLabel(model, index + 1)}
                </span>
                <span className={`mt-1 block text-xs ${active ? "text-slate-100" : "text-slate-500"}`}>
                  {model.model || `${language === "ko" ? "모델" : "Model"} ${index + 1}`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label={language === "ko" ? "탭 이름" : "Tab Name"}
            value={visionConfig.label}
            onChange={(event) => updateActiveVisionConfig({ label: event.target.value })}
          />
          <InputField
            label={t("field.vision_url")}
            value={visionConfig.url}
            onChange={(event) => updateActiveVisionConfig({ url: event.target.value })}
            placeholder="http://vision-host:8000/v1/chat/completions"
          />
          <InputField
            label={t("field.model")}
            value={visionConfig.model}
            onChange={(event) => updateActiveVisionConfig({ model: event.target.value })}
          />
          <InputField
            label={t("field.api_key")}
            type="password"
            value={visionConfig.apiKey}
            onChange={(event) => updateActiveVisionConfig({ apiKey: event.target.value })}
            placeholder={t("common.optional")}
          />
          <InputField
            label={t("field.timeout_ms")}
            type="number"
            value={String(visionConfig.timeoutMs)}
            onChange={(event) =>
              updateActiveVisionConfig({ timeoutMs: Number(event.target.value || 0) })
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <InputField
            label={t("field.temperature")}
            type="number"
            step="0.1"
            value={String(visionConfig.temperature)}
            onChange={(event) =>
              updateActiveVisionConfig({ temperature: Number(event.target.value || 0) })
            }
          />
          <InputField
            label={t("field.max_tokens")}
            type="number"
            value={String(visionConfig.maxTokens)}
            onChange={(event) => updateActiveVisionConfig({ maxTokens: Number(event.target.value || 0) })}
          />
          <InputField
            label={t("field.top_p")}
            type="number"
            step="0.1"
            value={String(visionConfig.topP)}
            onChange={(event) => updateActiveVisionConfig({ topP: Number(event.target.value || 0) })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            checked={visionConfig.useHardcodedPrompts}
            onChange={(checked) => updateActiveVisionConfig({ useHardcodedPrompts: checked })}
            label={t("toggle.use_hardcoded_prompts")}
          />
          <InfoTooltip content={t("help.vision_hardcoded_prompts")} />
        </div>

        <TextareaField
          label={t("field.system_prompt")}
          value={visionConfig.systemPrompt}
          onChange={(event) => updateActiveVisionConfig({ systemPrompt: event.target.value })}
          className="min-h-24"
        />
        <TextareaField
          label={t("field.user_prompt")}
          value={visionConfig.userPrompt}
          onChange={(event) => updateActiveVisionConfig({ userPrompt: event.target.value })}
          className="min-h-28"
        />
        <TextareaField
          label={t("field.extraction_rules")}
          value={visionConfig.extractionRules}
          onChange={(event) => updateActiveVisionConfig({ extractionRules: event.target.value })}
          className="min-h-24"
        />

        <div className="flex flex-wrap gap-3">
          <Toggle
            checked={visionConfig.referenceEnabled}
            onChange={(checked) => updateActiveVisionConfig({ referenceEnabled: checked })}
            label={t("toggle.use_reference_text")}
          />
          <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-teal">
            {t("button.upload_reference_text")}
            <input
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={(event) => void handleReferenceUpload(event, "vision")}
            />
          </label>
        </div>

        <TextareaField
          label={t("field.reference_text")}
          value={visionConfig.referenceText}
          onChange={(event) => updateActiveVisionConfig({ referenceText: event.target.value })}
          className="min-h-28"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <TextareaField
            label={t("field.extra_headers_json")}
            value={visionConfig.headersJson}
            onChange={(event) => updateActiveVisionConfig({ headersJson: event.target.value })}
            className="min-h-24 font-mono"
          />
          <TextareaField
            label={t("field.extra_body_json")}
            value={visionConfig.extraBodyJson}
            onChange={(event) => updateActiveVisionConfig({ extraBodyJson: event.target.value })}
            className="min-h-24 font-mono"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => void handleTestVisionCall()}
          >
            {t("button.check_connection")}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t("json.connection_note")}</p>

        {activeVisionTestResult ? (
          <JsonViewer
            label={`${activeVisionDisplayLabel} ${t("json.vision_test")}`}
            data={activeVisionTestResult}
          />
        ) : null}
      </SectionCard>

      <SectionCard title={t("section.scope.title")} subtitle={t("section.scope.subtitle")}>
        <div className="flex flex-wrap gap-3">
          {rangeModes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setRangeMode(mode)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                visionConfig.rangeMode === mode
                  ? ACTIVE_PILL_CLASS
                  : INACTIVE_PILL_CLASS
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(visionConfig.rangeMode === "page_range" || visionConfig.rangeMode === "page_and_roi") &&
        activeFileMeta?.mimeType === "application/pdf" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label={t("field.page_start")}
              type="number"
              min="1"
              max={String(activeFileMeta.pageCount)}
              value={String(visionConfig.pageRangeStart)}
              onChange={(event) =>
                updateActiveVisionConfig({ pageRangeStart: Number(event.target.value || 1) })
              }
            />
            <InputField
              label={t("field.page_end")}
              type="number"
              min="1"
              max={String(activeFileMeta.pageCount)}
              value={String(visionConfig.pageRangeEnd)}
              onChange={(event) =>
                updateActiveVisionConfig({ pageRangeEnd: Number(event.target.value || 1) })
              }
            />
          </div>
        ) : null}

        {roiEnabled ? (
          <>
            <RoiSelector
              file={selectedFile}
              page={previewPage}
              onPageChange={handlePreviewRoiPageChange}
              pageCount={activeFileMeta?.pageCount || 1}
              roi={activeVisionRoi}
              onRoiChange={updateRoi}
              enabled={roiEnabled}
            />
            <div className="grid gap-4 md:grid-cols-5">
              <InputField
                label={t("field.x")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(activeVisionRoi.x)}
                onChange={(event) => updateRoi({ x: Number(event.target.value || 0) })}
              />
              <InputField
                label={t("field.y")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(activeVisionRoi.y)}
                onChange={(event) => updateRoi({ y: Number(event.target.value || 0) })}
              />
              <InputField
                label={t("field.width")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(activeVisionRoi.width)}
                onChange={(event) => updateRoi({ width: Number(event.target.value || 0.1) })}
              />
              <InputField
                label={t("field.height")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(activeVisionRoi.height)}
                onChange={(event) => updateRoi({ height: Number(event.target.value || 0.1) })}
              />
              <InputField
                label={t("field.roi_page")}
                type="number"
                min="1"
                max={String(activeFileMeta?.pageCount || 1)}
                value={String(visionConfig.rangeMode === "page_and_roi" ? previewPage : activeVisionRoi.page || 1)}
                onChange={(event) => handlePreviewRoiPageChange(Number(event.target.value || 1))}
              />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {t("scope.roi_disabled")}
          </div>
        )}
      </SectionCard>
          </>
        ) : null}

        {ocrSetupView === "postprocess" ? (
      <SectionCard
        title={t("section.postprocess.title")}
        subtitle={t("section.postprocess.subtitle")}
      >
        <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-sm font-semibold text-ink">{t("section.postprocess_sources.title")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("section.postprocess_sources.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Toggle
              checked={postprocessConfig.includeOpendataloader}
              onChange={(checked) => updatePostprocessConfig({ includeOpendataloader: checked })}
              label={t("results.opendataloader")}
            />
            <Toggle
              checked={postprocessConfig.includeUpstage}
              onChange={(checked) => updatePostprocessConfig({ includeUpstage: checked })}
              label={t("results.upstage")}
            />
            <Toggle
              checked={postprocessConfig.includeVision}
              onChange={(checked) => updatePostprocessConfig({ includeVision: checked })}
              label={t("results.vision")}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label={t("field.postprocess_url")}
            value={postprocessConfig.url}
            onChange={(event) => updatePostprocessConfig({ url: event.target.value })}
            placeholder="http://llm-host:8000/v1/chat/completions"
          />
          <InputField
            label={t("field.model")}
            value={postprocessConfig.model}
            onChange={(event) => updatePostprocessConfig({ model: event.target.value })}
          />
          <InputField
            label={t("field.api_key")}
            type="password"
            value={postprocessConfig.apiKey}
            onChange={(event) => updatePostprocessConfig({ apiKey: event.target.value })}
            placeholder={t("common.optional")}
          />
          <InputField
            label={t("field.timeout_ms")}
            type="number"
            value={String(postprocessConfig.timeoutMs)}
            onChange={(event) =>
              updatePostprocessConfig({ timeoutMs: Number(event.target.value || 0) })
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <InputField
            label={t("field.temperature")}
            type="number"
            step="0.1"
            value={String(postprocessConfig.temperature)}
            onChange={(event) =>
              updatePostprocessConfig({ temperature: Number(event.target.value || 0) })
            }
          />
          <InputField
            label={t("field.max_tokens")}
            type="number"
            value={String(postprocessConfig.maxTokens)}
            onChange={(event) =>
              updatePostprocessConfig({ maxTokens: Number(event.target.value || 0) })
            }
          />
          <InputField
            label={t("field.top_p")}
            type="number"
            step="0.1"
            value={String(postprocessConfig.topP)}
            onChange={(event) => updatePostprocessConfig({ topP: Number(event.target.value || 0) })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            checked={postprocessConfig.useHardcodedPrompts}
            onChange={(checked) => updatePostprocessConfig({ useHardcodedPrompts: checked })}
            label={t("toggle.use_hardcoded_prompts")}
          />
          <InfoTooltip content={t("help.postprocess_hardcoded_prompts")} />
        </div>

        <TextareaField
          label={t("field.system_prompt")}
          value={postprocessConfig.systemPrompt}
          onChange={(event) => updatePostprocessConfig({ systemPrompt: event.target.value })}
          className="min-h-24"
        />
        <TextareaField
          label={t("field.user_prompt")}
          value={postprocessConfig.userPrompt}
          onChange={(event) => updatePostprocessConfig({ userPrompt: event.target.value })}
          className="min-h-28"
        />

        <div className="flex flex-wrap gap-3">
          <Toggle
            checked={postprocessConfig.referenceEnabled}
            onChange={(checked) => updatePostprocessConfig({ referenceEnabled: checked })}
            label={t("toggle.use_reference_text")}
          />
          <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-teal">
            {t("button.upload_reference_text")}
            <input
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={(event) => void handleReferenceUpload(event, "postprocess")}
            />
          </label>
        </div>

        <TextareaField
          label={t("field.reference_text")}
          value={postprocessConfig.referenceText}
          onChange={(event) => updatePostprocessConfig({ referenceText: event.target.value })}
          className="min-h-28"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <TextareaField
            label={t("field.extra_headers_json")}
            value={postprocessConfig.headersJson}
            onChange={(event) => updatePostprocessConfig({ headersJson: event.target.value })}
            className="min-h-24 font-mono"
          />
          <TextareaField
            label={t("field.extra_body_json")}
            value={postprocessConfig.extraBodyJson}
            onChange={(event) => updatePostprocessConfig({ extraBodyJson: event.target.value })}
            className="min-h-24 font-mono"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => void handleTestPostprocessCall()}
          >
            {t("button.check_connection")}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t("json.connection_note")}</p>

        {postprocessTestResult ? (
          <JsonViewer label={t("json.postprocess_test")} data={postprocessTestResult} />
        ) : null}
      </SectionCard>
        ) : null}
      </div>
    </div>
  );

  const rightColumn = (
    <div className="space-y-6">
      <div
        id="workspace-run_center"
        className={activeWorkspaceSection === "run_center" ? "block" : "hidden"}
      >
        <SectionCard
          title={t("section.run_controls.title")}
          subtitle={t("section.run_controls.subtitle")}
        >
        <div className="grid gap-3">
          {stageActions.map(([key, action, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => void action()}
              disabled={runStatus[key].state === "running"}
              className={`flex items-center justify-between rounded-[24px] border px-5 py-4 text-left transition ${
                key === "pipeline"
                  ? "border-coral bg-coral text-white hover:opacity-90"
                  : "border-slate-200 bg-white text-ink hover:border-teal"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="font-medium">{label}</span>
              <StatusPill language={language} status={runStatus[key]} />
            </button>
          ))}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
            {t("section.stage_status")}
          </p>
          <div className="mt-3 space-y-3">
            {(Object.keys(runStatus) as StageKey[]).map((key) => (
              <div
                key={key}
                className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{getStageLabel(language, key)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {runStatus[key].message || t("common.none")}
                  </p>
                </div>
                <StatusPill language={language} status={runStatus[key]} />
              </div>
            ))}
          </div>
        </div>
        </SectionCard>
      </div>

      <div
        id="workspace-library"
        className={activeWorkspaceSection === "library" ? "space-y-6" : "hidden"}
      >
        <SectionCard title={t("section.presets.title")} subtitle={t("section.presets.subtitle")}>
        <div className="space-y-4">
          <InputField
            label={t("field.preset_name")}
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <TextareaField
            label={t("field.description")}
            value={presetDescription}
            onChange={(event) => setPresetDescription(event.target.value)}
            className="min-h-20"
          />
          <button
            type="button"
            className="w-full rounded-full bg-teal px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
            onClick={() => void handleSavePreset()}
          >
            {t("button.save_current_configuration")}
          </button>
        </div>

        <div className="space-y-3">
          {presets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              {t("presets.empty")}
            </div>
          ) : (
            visiblePresets.map((preset) => (
              <div
                key={preset.id}
                className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
              >
                <p className="font-medium text-ink">{preset.name}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {preset.description || t("presets.no_description")}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {t("presets.updated")} {isoToLabel(preset.updatedAt)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleLoadPreset(preset)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
                  >
                    {t("button.load")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdatePreset(preset)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-coral hover:text-coral"
                  >
                    {t("button.overwrite")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeletePreset(preset.id)}
                    className="rounded-full border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    {t("button.delete")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {presets.length > PRESETS_PER_PAGE ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPresetPage((current) => Math.max(1, current - 1))}
              disabled={presetPage === 1}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              {"<"}
            </button>
            {Array.from({ length: totalPresetPages }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setPresetPage(page)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  page === presetPage
                    ? ACTIVE_TAB_CLASS
                    : INACTIVE_TAB_CLASS
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetPage((current) => Math.min(totalPresetPages, current + 1))}
              disabled={presetPage === totalPresetPages}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              {">"}
            </button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title={t("section.history.title")} subtitle={t("section.history.subtitle")}>
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              {t("history.empty")}
            </div>
          ) : (
            visibleHistory.map((item) => (
              <div
                key={item.id}
                className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">
                      {item.fileName || t("history.no_file")}{" "}
                      <span className="text-slate-400">#{item.id}</span>
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatHistoryMeta(language, item)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleLoadHistory(item)}
                      className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
                    >
                      {t("button.load_result")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteHistory(item.id)}
                      className="rounded-full border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      {t("button.delete")}
                    </button>
                  </div>
                </div>
                {item.roi ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {t("history.roi")}: x {item.roi.x.toFixed(3)} / y {item.roi.y.toFixed(3)} / w{" "}
                    {item.roi.width.toFixed(3)} / h {item.roi.height.toFixed(3)}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>

        {history.length > HISTORY_PER_PAGE ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
              disabled={historyPage === 1}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              {"<"}
            </button>
            {Array.from({ length: totalHistoryPages }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setHistoryPage(page)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  page === historyPage
                    ? ACTIVE_TAB_CLASS
                    : INACTIVE_TAB_CLASS
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))}
              disabled={historyPage === totalHistoryPages}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
            >
              {">"}
            </button>
          </div>
        ) : null}
      </SectionCard>
      </div>
    </div>
  );

  const resultsPanel = (
    <div
      id="workspace-results"
      className={activeWorkspaceSection === "results" ? "mt-0" : "hidden"}
    >
      <SectionCard
        title={t("section.results.title")}
        subtitle={resultsWorkspaceSubtitle}
      >
        <div className="flex flex-wrap gap-2">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setResultsView(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                resultsView === tab.key
                  ? ACTIVE_TAB_CLASS
                  : INACTIVE_TAB_CLASS
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {resultsView === "compare" ? (
          <div className="space-y-4">
            {/*
            <div className="hidden">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                    {language === "ko" ? "비교 조합" : "Comparison Set"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {language === "ko"
                      ? "두 결과를 넓게 나란히 보거나, 필요하면 전체 3개 결과를 한 번에 확인할 수 있습니다."
                      : "Open two results side by side for larger reading space, or switch to the all-three view when needed."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {compareModeTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => undefined}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        compareMode === tab.key
                          ? ACTIVE_TAB_CLASS
                          : INACTIVE_TAB_CLASS
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            */}

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
              {language === "ko"
                ? `등록된 Vision 모델 ${visionRegistry.models.length}개가 각각 독립 실행된 결과입니다. Postprocess와 Full Pipeline은 현재 활성 탭 ${activeVisionDisplayLabel} 기준으로 동작합니다.`
                : `${visionRegistry.models.length} registered Vision models run independently. Postprocess and Full Pipeline use the currently selected OCR sources and the active Vision tab, ${activeVisionDisplayLabel}.`}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {comparePanes.map((pane) => (
                renderWorkspacePane(pane, {
                  key: pane.title,
                  className: "min-h-[42rem]",
                  textareaClassName: "h-[30rem] md:h-[36rem] xl:h-[42rem]",
                  contentClassName: "space-y-4",
                })
              ))}
            </div>
          </div>
        ) : null}

        {resultsView === "vision" ? (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
              {language === "ko"
                ? `현재 활성 Vision 탭은 ${activeVisionDisplayLabel}이며, Postprocess와 Full Pipeline이 이 탭의 결과를 사용합니다.`
                : `The active Vision tab is ${activeVisionDisplayLabel}. Postprocess and Full Pipeline use this tab's result when Vision input is enabled.`}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {visionPaneEntries.map(({ model, pane }) => (
                <ResultPane
                  key={model.id}
                  title={
                    activeVisionModel?.id === model.id
                      ? `${pane.title} · ${language === "ko" ? "활성" : "Active"}`
                      : pane.title
                  }
                  text={pane.text}
                  raw={pane.raw}
                  statusCode={pane.statusCode}
                  promptPreview={pane.promptPreview}
                  referencePreview={pane.referencePreview}
                  errorMessage={pane.errorMessage}
                  className="min-h-[42rem]"
                  textareaClassName="h-[30rem] md:h-[36rem] xl:h-[42rem]"
                  contentClassName="space-y-4"
                />
              ))}
            </div>
          </div>
        ) : null}

        {focusedPane ? (
          <div className="space-y-4">
            {renderWorkspacePane(focusedPane, {
              key: focusedPane.title,
              className: "min-h-[48rem]",
              textareaClassName: "h-[34rem] md:h-[40rem] xl:h-[48rem]",
              contentClassName: "space-y-4",
            })}

            {focusedPaneKey === "upstage" ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {focusedPaneKey === "upstage" ? (
                  <JsonViewer
                    label={t("results.upstage_summary")}
                    data={{
                      content: results.upstage?.content || {},
                      elements: results.upstage?.elements || [],
                      usage: results.upstage?.usage || {},
                      pageCount: results.upstage?.pageCount || null,
                    }}
                    defaultOpen
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {resultsView === "insights" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {visionPaneEntries.map(({ model }) => {
              const result = results.vision[model.id] || null;
              return (
                <React.Fragment key={`vision-insights-range-${model.id}`}>
                  <JsonViewer
                    label={`${buildVisionResultTitle(language, model)} ${language === "ko" ? "범위 정보" : "Range Info"}`}
                    data={result?.range || {}}
                    defaultOpen={activeVisionModel?.id === model.id}
                  />
                </React.Fragment>
              );
            })}
            <JsonViewer
              label={`${t("results.opendataloader")} ${language === "ko" ? "원본 JSON" : "Raw JSON"}`}
              data={results.opendataloader?.raw || {}}
            />
            <JsonViewer
              label={t("results.upstage_summary")}
              data={{
                content: results.upstage?.content || {},
                elements: results.upstage?.elements || [],
                usage: results.upstage?.usage || {},
                pageCount: results.upstage?.pageCount || null,
              }}
              defaultOpen
            />
            <JsonViewer
              label={`${t("results.vision")} ${language === "ko" ? "원본 JSON" : "Raw JSON"}`}
              data={activeVisionResult?.raw || {}}
            />
            <JsonViewer
              label={`${t("results.postprocess")} ${language === "ko" ? "원본 JSON" : "Raw JSON"}`}
              data={results.postprocess?.raw || {}}
            />
          </div>
        ) : null}
      </SectionCard>
    </div>
  );

  const currentWorkspaceContent =
    activeWorkspaceSection === "document" || activeWorkspaceSection === "ocr_setup"
      ? leftColumn
      : activeWorkspaceSection === "run_center" || activeWorkspaceSection === "library"
        ? rightColumn
        : resultsPanel;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_28%),linear-gradient(180deg,_#f8f4ec_0%,_#f2eee6_100%)]">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal">
                {t("header.badge")}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {t("header.title")}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">{t("header.subtitle")}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {t("language.label")}
                </span>
                <div className="inline-flex rounded-full border border-slate-300 bg-white p-1">
                  {(["en", "ko"] as AppLanguage[]).map((option) => {
                    const active = language === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setLanguage(option)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          active ? ACTIVE_TAB_CLASS : "text-slate-600 hover:text-ink"
                        }`}
                      >
                        {option === "en" ? t("language.english") : t("language.korean")}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={resetDashboardState}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-500"
              >
                {t("header.reset")}
              </button>
            </div>
          </div>
        </header>

        <div
          className={`grid gap-6 ${
            isWorkspaceMenuCollapsed
              ? "xl:grid-cols-[96px_minmax(0,1fr)]"
              : "xl:grid-cols-[280px_minmax(0,1fr)]"
          }`}
        >
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div
              className={`rounded-[28px] border border-white/70 bg-white/88 shadow-panel backdrop-blur transition-all ${
                isWorkspaceMenuCollapsed ? "p-3" : "p-4"
              }`}
            >
              <div
                className={`border-b border-slate-200/80 ${
                  isWorkspaceMenuCollapsed ? "px-1 pb-3" : "px-2 pb-4"
                }`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-[0.28em] text-teal ${
                    isWorkspaceMenuCollapsed ? "hidden" : "block"
                  }`}
                >
                  {language === "ko" ? "작업 메뉴" : "Workspace Menu"}
                </p>
                <p
                  className={`mt-2 text-sm leading-6 text-slate-600 ${
                    isWorkspaceMenuCollapsed ? "hidden" : "block"
                  }`}
                >
                  {language === "ko"
                    ? "왼쪽 메뉴로 작업 단계를 나누고, 필요한 영역으로 바로 이동할 수 있습니다."
                    : "Use the left menu to move between workflow stages and keep related tasks grouped together."}
                </p>
                <button
                  type="button"
                  onClick={() => setIsWorkspaceMenuCollapsed((current) => !current)}
                  className={`mt-3 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal ${
                    isWorkspaceMenuCollapsed ? "w-full" : ""
                  }`}
                >
                  {isWorkspaceMenuCollapsed
                    ? language === "ko"
                      ? "펼치기"
                      : "Expand"
                    : language === "ko"
                      ? "접기"
                      : "Collapse"}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {workspaceMenuItems.map((item) => {
                  const active = activeWorkspaceSection === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      onClick={() => handleWorkspaceMenuSelect(item.key)}
                      className={`flex w-full rounded-[22px] text-left transition ${
                        active
                          ? `${ACTIVE_TAB_CLASS} border border-ink`
                          : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-ink hover:bg-white"
                      } ${
                        isWorkspaceMenuCollapsed
                          ? "items-center justify-center px-2 py-4"
                          : "items-start gap-3 px-4 py-4"
                      }`}
                    >
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          active
                            ? "bg-white text-ink shadow-sm"
                            : "bg-white text-slate-500 ring-1 ring-slate-200"
                        }`}
                      >
                        {item.step}
                      </span>
                      <span className={isWorkspaceMenuCollapsed ? "hidden" : "min-w-0"}>
                        <span className="block text-sm font-semibold">{item.label}</span>
                        <span
                          className={`mt-1 block text-xs leading-5 ${
                            active ? "text-slate-100" : "text-slate-500"
                          }`}
                        >
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            <section className="rounded-[28px] border border-white/70 bg-white/78 p-4 shadow-panel backdrop-blur sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                    {language === "ko" ? "현재 작업" : "Current Workspace"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                    {workspaceMenuItems.find((item) => item.key === activeWorkspaceSection)?.label}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {
                      workspaceMenuItems.find((item) => item.key === activeWorkspaceSection)
                        ?.description
                    }
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  {language === "ko" ? "단계" : "Step"}{" "}
                  {workspaceMenuItems.find((item) => item.key === activeWorkspaceSection)?.step}
                </div>
              </div>
            </section>

            {currentWorkspaceContent}
          </div>
        </div>
      </div>
    </div>
  );
}
