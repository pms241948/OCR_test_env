import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

import { JsonViewer } from "../components/JsonViewer";
import { ResultPane } from "../components/ResultPane";
import { RoiSelector } from "../components/RoiSelector";
import { SectionCard } from "../components/SectionCard";
import { useAppStore } from "../stores/useAppStore";
import {
  checkUpstageEndpointsApi,
  createPresetApi,
  deletePresetApi,
  fetchHistoryApi,
  fetchPresetsApi,
  registerUpstageLicenseApi,
  runAllApi,
  runPostprocessApi,
  runUpstageApi,
  runVisionApi,
  updatePresetApi,
} from "../utils/api";
import { formatBytes, getLocalFileMeta, isoToLabel, readTextFile } from "../utils/file";
import type {
  HistoryRecord,
  PresetRecord,
  RangeMode,
  Roi,
  StageKey,
  StageResponse,
  StoredConfigBundle,
} from "../utils/types";

type RunStatus = {
  state: "idle" | "running" | "success" | "error";
  message?: string;
};

type RunStatusMap = Record<StageKey, RunStatus>;

const stageLabels: Record<StageKey, string> = {
  upstage: "Upstage DP",
  vision: "Vision OCR",
  postprocess: "Postprocess LLM",
  pipeline: "Run All",
};

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
          ? "border-teal bg-teal text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-teal"
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-white" : "bg-slate-300"}`} />
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
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
        ? "Idle"
        : status.state === "running"
          ? "Running"
          : status.state === "success"
            ? "Success"
            : "Error"}
    </span>
  );
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (
      (error.response?.data as { error?: { message?: string } })?.error?.message ||
      error.message
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function resolveUpstageText(result: StageResponse | null): string {
  if (!result) {
    return "";
  }

  return result.content?.markdown || result.content?.text || result.content?.html || "";
}

function buildBundle(config: {
  upstage: ReturnType<typeof useAppStore.getState>["upstageConfig"];
  vision: ReturnType<typeof useAppStore.getState>["visionConfig"];
  postprocess: ReturnType<typeof useAppStore.getState>["postprocessConfig"];
}): StoredConfigBundle {
  return {
    upstage: config.upstage,
    vision: config.vision,
    postprocess: config.postprocess,
  };
}

function coerceBundle(input: unknown): StoredConfigBundle | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeBundle = input as Partial<StoredConfigBundle>;
  if (maybeBundle.upstage && maybeBundle.vision && maybeBundle.postprocess) {
    return maybeBundle as StoredConfigBundle;
  }

  return null;
}

function coerceStageResult(input: unknown): StageResponse | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  return input as StageResponse;
}

export function DashboardPage() {
  const {
    upstageConfig,
    visionConfig,
    postprocessConfig,
    fileMeta,
    results,
    presets,
    history,
    updateUpstageConfig,
    updateVisionConfig,
    updatePostprocessConfig,
    setFileMeta,
    setStageResult,
    resetResults,
    setPresets,
    setHistory,
    applyConfigBundle,
    resetConfigs,
  } = useAppStore();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [endpointCheckResult, setEndpointCheckResult] = useState<unknown>(null);
  const [licenseResult, setLicenseResult] = useState<unknown>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [runStatus, setRunStatus] = useState<RunStatusMap>({
    upstage: { state: "idle" },
    vision: { state: "idle" },
    postprocess: { state: "idle" },
    pipeline: { state: "idle" },
  });

  const currentBundle = useMemo(
    () =>
      buildBundle({
        upstage: upstageConfig,
        vision: visionConfig,
        postprocess: postprocessConfig,
      }),
    [postprocessConfig, upstageConfig, visionConfig]
  );

  const roiEnabled =
    visionConfig.rangeMode === "roi" || visionConfig.rangeMode === "page_and_roi";

  useEffect(() => {
    void refreshSidebarData();
  }, []);

  async function refreshSidebarData() {
    const [historyItems, presetItems] = await Promise.all([
      fetchHistoryApi(),
      fetchPresetsApi(),
    ]);

    setHistory(historyItems);
    setPresets(presetItems);
  }

  async function handleFileSelection(file: File | null) {
    if (!file) {
      setSelectedFile(null);
      setFileMeta(null);
      resetResults();
      return;
    }

    if (
      !["application/pdf", "image/png", "image/jpeg"].includes(file.type) &&
      !/\.(pdf|png|jpe?g)$/i.test(file.name)
    ) {
      alert("Only PDF, PNG, JPG and JPEG are supported.");
      return;
    }

    const meta = await getLocalFileMeta(file);
    setSelectedFile(file);
    setFileMeta(meta);
    resetResults();
    setPreviewPage(1);
    updateVisionConfig({
      pageRangeStart: 1,
      pageRangeEnd: meta.pageCount,
      roi: {
        ...visionConfig.roi,
        page: 1,
      },
    });
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
      markStage(stage, { state: "error", message: getErrorMessage(error) });
    }
  }

  async function handleRunUpstage() {
    if (!selectedFile) {
      alert("Upload a file first.");
      return;
    }

    await executeStage("upstage", async () => {
      const response = await runUpstageApi(selectedFile, upstageConfig);
      setStageResult("upstage", response);
      if (response.file) {
        setFileMeta(response.file);
      }
    });
  }

  async function handleRunVision() {
    if (!selectedFile) {
      alert("Upload a file first.");
      return;
    }

    await executeStage("vision", async () => {
      const response = await runVisionApi(selectedFile, visionConfig);
      setStageResult("vision", response);
      if (response.file) {
        setFileMeta(response.file);
      }
    });
  }

  async function handleRunPostprocess() {
    if (!fileMeta || !results.upstage || !results.vision) {
      alert("Run Upstage and Vision first.");
      return;
    }

    await executeStage("postprocess", async () => {
      const response = await runPostprocessApi({
        file: fileMeta,
        upstageResult: results.upstage,
        visionResult: results.vision,
        config: postprocessConfig,
      });
      setStageResult("postprocess", response);
    });
  }

  async function handleRunAll() {
    if (!selectedFile) {
      alert("Upload a file first.");
      return;
    }

    await executeStage("pipeline", async () => {
      const response = await runAllApi(selectedFile, currentBundle);
      setFileMeta(response.file);
      setStageResult("upstage", response.upstage);
      setStageResult("vision", response.vision);
      setStageResult("postprocess", response.postprocess);
      markStage("upstage", { state: "success" });
      markStage("vision", { state: "success" });
      markStage("postprocess", { state: "success" });
    });
  }

  async function handleCheckEndpoints() {
    if (!upstageConfig.endpointsUrl) {
      alert("Enter the endpoint check URL.");
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
      setEndpointCheckResult({ error: getErrorMessage(error) });
    }
  }

  async function handleRegisterLicense() {
    if (!upstageConfig.licenseUrl) {
      alert("Enter the license URL.");
      return;
    }

    try {
      const response = await registerUpstageLicenseApi({
        url: upstageConfig.licenseUrl,
        licenseKey: upstageConfig.licenseKey,
        headersJson: upstageConfig.headersJson,
        bodyJson: upstageConfig.licenseBodyJson,
        timeoutMs: upstageConfig.timeoutMs,
        retryCount: upstageConfig.retryCount,
      });
      setLicenseResult(response);
    } catch (error) {
      setLicenseResult({ error: getErrorMessage(error) });
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
      updateVisionConfig({ referenceText: text, referenceEnabled: true });
    } else {
      updatePostprocessConfig({ referenceText: text, referenceEnabled: true });
    }
  }

  async function handleSavePreset() {
    if (!presetName.trim()) {
      alert("Enter a preset name.");
      return;
    }

    await createPresetApi({
      name: presetName.trim(),
      description: presetDescription.trim(),
      config: currentBundle,
    });
    setPresetName("");
    setPresetDescription("");
    await refreshSidebarData();
  }

  async function handleUpdatePreset(preset: PresetRecord) {
    await updatePresetApi(preset.id, {
      name: preset.name,
      description: preset.description,
      config: currentBundle,
    });
    await refreshSidebarData();
  }

  async function handleDeletePreset(id: number) {
    await deletePresetApi(id);
    await refreshSidebarData();
  }

  function handleLoadPreset(preset: PresetRecord) {
    applyConfigBundle(preset.config);
  }

  function handleLoadHistory(item: HistoryRecord) {
    const bundle = coerceBundle(item.config);
    if (bundle) {
      applyConfigBundle(bundle);
    } else if (item.runType === "upstage") {
      updateUpstageConfig(item.config as Partial<typeof upstageConfig>);
    } else if (item.runType === "vision_llm") {
      updateVisionConfig(item.config as Partial<typeof visionConfig>);
    } else if (item.runType === "postprocess") {
      updatePostprocessConfig(item.config as Partial<typeof postprocessConfig>);
    }

    const result = item.result as Record<string, unknown>;
    if (item.runType === "full_pipeline") {
      setStageResult("upstage", coerceStageResult(result.upstage));
      setStageResult("vision", coerceStageResult(result.vision));
      setStageResult("postprocess", coerceStageResult(result.postprocess));
    } else if (item.runType === "upstage") {
      setStageResult("upstage", coerceStageResult(item.result));
    } else if (item.runType === "vision_llm") {
      setStageResult("vision", coerceStageResult(item.result));
    } else if (item.runType === "postprocess") {
      setStageResult("postprocess", coerceStageResult(item.result));
    }

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

  function updateRoi(patch: Partial<Roi>) {
    updateVisionConfig({
      roi: {
        ...visionConfig.roi,
        ...patch,
      },
    });
  }

  function setRangeMode(mode: RangeMode) {
    updateVisionConfig({
      rangeMode: mode,
    });
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.18),_transparent_28%),linear-gradient(180deg,_#f8f4ec_0%,_#f2eee6_100%)]">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal">
                OCR Compare Lab
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Compare Upstage DP, vision OCR, and postprocess output in one workspace
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Tune prompts, reference text, ROI, and endpoint options without leaving the page.
                Recent configuration stays in local storage, while presets and run history are
                stored on the backend.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetConfigs();
                resetResults();
              }}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-500"
            >
              Reset Settings
            </button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <SectionCard
              title="File Upload"
              subtitle="Upload one PDF or image file, inspect metadata, and reuse the same file across all runs."
            >
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-teal hover:bg-white">
                <span className="text-base font-medium text-ink">Select a file</span>
                <span className="mt-2 text-sm text-slate-500">Supported: PDF, PNG, JPG, JPEG</span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(event) => {
                    void handleFileSelection(event.target.files?.[0] || null);
                  }}
                />
              </label>

              {fileMeta ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">File</p>
                    <p className="mt-2 break-all text-sm font-medium text-ink">{fileMeta.fileName}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Size</p>
                    <p className="mt-2 text-sm font-medium text-ink">{formatBytes(fileMeta.fileSize)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">MIME</p>
                    <p className="mt-2 text-sm font-medium text-ink">{fileMeta.mimeType}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Pages</p>
                    <p className="mt-2 text-sm font-medium text-ink">{fileMeta.pageCount}</p>
                  </div>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Upstage DP"
              subtitle="Proxy the uploaded file to a user-supplied Document Parse endpoint."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                  label="DP URL"
                  value={upstageConfig.url}
                  onChange={(event) => updateUpstageConfig({ url: event.target.value })}
                  placeholder="http://dp-server:8080/v1/document-parse"
                />
                <InputField
                  label="Endpoint Check URL"
                  value={upstageConfig.endpointsUrl}
                  onChange={(event) => updateUpstageConfig({ endpointsUrl: event.target.value })}
                  placeholder="http://dp-server:8080/api/endpoints"
                />
                <InputField
                  label="License URL"
                  value={upstageConfig.licenseUrl}
                  onChange={(event) => updateUpstageConfig({ licenseUrl: event.target.value })}
                  placeholder="http://dp-server:8080/api/license"
                />
                <InputField
                  label="Model"
                  value={upstageConfig.model}
                  onChange={(event) => updateUpstageConfig({ model: event.target.value })}
                  placeholder="Optional"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">OCR Mode</span>
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
                  label="Timeout (ms)"
                  type="number"
                  value={String(upstageConfig.timeoutMs)}
                  onChange={(event) =>
                    updateUpstageConfig({ timeoutMs: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="Retry Count"
                  type="number"
                  value={String(upstageConfig.retryCount)}
                  onChange={(event) =>
                    updateUpstageConfig({ retryCount: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="License Key"
                  value={upstageConfig.licenseKey}
                  onChange={(event) => updateUpstageConfig({ licenseKey: event.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Toggle
                  checked={upstageConfig.coordinates}
                  onChange={(checked) => updateUpstageConfig({ coordinates: checked })}
                  label="Include Coordinates"
                />
                <Toggle
                  checked={upstageConfig.base64Encoding}
                  onChange={(checked) => updateUpstageConfig({ base64Encoding: checked })}
                  label="base64_encoding"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Output Formats</p>
                <div className="flex flex-wrap gap-3">
                  {["text", "html", "markdown"].map((format) => {
                    const active = upstageConfig.outputFormats.includes(format);
                    return (
                      <button
                        key={format}
                        type="button"
                        onClick={() => {
                          updateUpstageConfig({
                            outputFormats: active
                              ? upstageConfig.outputFormats.filter((item) => item !== format)
                              : [...upstageConfig.outputFormats, format],
                          });
                        }}
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                          active
                            ? "border-teal bg-teal text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-teal"
                        }`}
                      >
                        {format}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <TextareaField
                  label="Extra Headers JSON"
                  value={upstageConfig.headersJson}
                  onChange={(event) => updateUpstageConfig({ headersJson: event.target.value })}
                  className="min-h-28 font-mono"
                />
                <TextareaField
                  label="License Body JSON"
                  value={upstageConfig.licenseBodyJson}
                  onChange={(event) =>
                    updateUpstageConfig({ licenseBodyJson: event.target.value })
                  }
                  className="min-h-28 font-mono"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
                  onClick={() => void handleCheckEndpoints()}
                >
                  Check Endpoints
                </button>
                <button
                  type="button"
                  className="rounded-full bg-coral px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  onClick={() => void handleRegisterLicense()}
                >
                  Register License
                </button>
              </div>

              {endpointCheckResult ? (
                <JsonViewer label="Endpoint Check Result" data={endpointCheckResult} />
              ) : null}
              {licenseResult ? <JsonViewer label="License Result" data={licenseResult} /> : null}
            </SectionCard>

            <SectionCard
              title="Vision OCR"
              subtitle="Tune a vision-capable OpenAI-compatible endpoint with prompt and reference text."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                  label="Vision URL"
                  value={visionConfig.url}
                  onChange={(event) => updateVisionConfig({ url: event.target.value })}
                  placeholder="http://vision-host:8000/v1/chat/completions"
                />
                <InputField
                  label="Model"
                  value={visionConfig.model}
                  onChange={(event) => updateVisionConfig({ model: event.target.value })}
                />
                <InputField
                  label="API Key"
                  type="password"
                  value={visionConfig.apiKey}
                  onChange={(event) => updateVisionConfig({ apiKey: event.target.value })}
                  placeholder="Optional"
                />
                <InputField
                  label="Timeout (ms)"
                  type="number"
                  value={String(visionConfig.timeoutMs)}
                  onChange={(event) =>
                    updateVisionConfig({ timeoutMs: Number(event.target.value || 0) })
                  }
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <InputField
                  label="Temperature"
                  type="number"
                  step="0.1"
                  value={String(visionConfig.temperature)}
                  onChange={(event) =>
                    updateVisionConfig({ temperature: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="Max Tokens"
                  type="number"
                  value={String(visionConfig.maxTokens)}
                  onChange={(event) =>
                    updateVisionConfig({ maxTokens: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="Top P"
                  type="number"
                  step="0.1"
                  value={String(visionConfig.topP)}
                  onChange={(event) =>
                    updateVisionConfig({ topP: Number(event.target.value || 0) })
                  }
                />
              </div>

              <TextareaField
                label="System Prompt"
                value={visionConfig.systemPrompt}
                onChange={(event) => updateVisionConfig({ systemPrompt: event.target.value })}
                className="min-h-24"
              />
              <TextareaField
                label="User Prompt"
                value={visionConfig.userPrompt}
                onChange={(event) => updateVisionConfig({ userPrompt: event.target.value })}
                className="min-h-28"
              />
              <TextareaField
                label="Extraction Rules"
                value={visionConfig.extractionRules}
                onChange={(event) => updateVisionConfig({ extractionRules: event.target.value })}
                className="min-h-24"
              />

              <div className="flex flex-wrap gap-3">
                <Toggle
                  checked={visionConfig.referenceEnabled}
                  onChange={(checked) => updateVisionConfig({ referenceEnabled: checked })}
                  label="Use Reference Text"
                />
                <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-teal">
                  Upload Reference Text
                  <input
                    type="file"
                    accept=".txt,.md"
                    className="hidden"
                    onChange={(event) => void handleReferenceUpload(event, "vision")}
                  />
                </label>
              </div>

              <TextareaField
                label="Reference Text"
                value={visionConfig.referenceText}
                onChange={(event) => updateVisionConfig({ referenceText: event.target.value })}
                className="min-h-28"
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <TextareaField
                  label="Extra Headers JSON"
                  value={visionConfig.headersJson}
                  onChange={(event) => updateVisionConfig({ headersJson: event.target.value })}
                  className="min-h-24 font-mono"
                />
                <TextareaField
                  label="Extra Body JSON"
                  value={visionConfig.extraBodyJson}
                  onChange={(event) => updateVisionConfig({ extraBodyJson: event.target.value })}
                  className="min-h-24 font-mono"
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Vision Scope"
              subtitle="Choose full document, page range, ROI only, or page range with ROI."
            >
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["full_document", "Full Document"],
                    ["page_range", "Page Range"],
                    ["roi", "ROI Only"],
                    ["page_and_roi", "Page + ROI"],
                  ] as [RangeMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRangeMode(mode)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      visionConfig.rangeMode === mode
                        ? "border-teal bg-teal text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-teal"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {(visionConfig.rangeMode === "page_range" ||
                visionConfig.rangeMode === "page_and_roi") &&
              fileMeta?.mimeType === "application/pdf" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <InputField
                    label="Page Start"
                    type="number"
                    min="1"
                    max={String(fileMeta.pageCount)}
                    value={String(visionConfig.pageRangeStart)}
                    onChange={(event) =>
                      updateVisionConfig({
                        pageRangeStart: Number(event.target.value || 1),
                      })
                    }
                  />
                  <InputField
                    label="Page End"
                    type="number"
                    min="1"
                    max={String(fileMeta.pageCount)}
                    value={String(visionConfig.pageRangeEnd)}
                    onChange={(event) =>
                      updateVisionConfig({
                        pageRangeEnd: Number(event.target.value || 1),
                      })
                    }
                  />
                </div>
              ) : null}

              {roiEnabled ? (
                <>
                  <RoiSelector
                    file={selectedFile}
                    page={previewPage}
                    onPageChange={setPreviewPage}
                    pageCount={fileMeta?.pageCount || 1}
                    roi={visionConfig.roi}
                    onRoiChange={(roi) => updateVisionConfig({ roi })}
                    enabled={roiEnabled}
                  />

                  <div className="grid gap-4 md:grid-cols-5">
                    <InputField
                      label="x"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={String(visionConfig.roi.x)}
                      onChange={(event) => updateRoi({ x: Number(event.target.value || 0) })}
                    />
                    <InputField
                      label="y"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={String(visionConfig.roi.y)}
                      onChange={(event) => updateRoi({ y: Number(event.target.value || 0) })}
                    />
                    <InputField
                      label="width"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={String(visionConfig.roi.width)}
                      onChange={(event) =>
                        updateRoi({ width: Number(event.target.value || 0.1) })
                      }
                    />
                    <InputField
                      label="height"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={String(visionConfig.roi.height)}
                      onChange={(event) =>
                        updateRoi({ height: Number(event.target.value || 0.1) })
                      }
                    />
                    <InputField
                      label="ROI Page"
                      type="number"
                      min="1"
                      max={String(fileMeta?.pageCount || 1)}
                      value={String(visionConfig.roi.page || 1)}
                      onChange={(event) =>
                        updateRoi({ page: Number(event.target.value || 1) })
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  ROI is disabled. The full document or selected page range will be sent to the
                  vision model.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Postprocess LLM"
              subtitle="Fuse Upstage OCR and vision OCR into one refined final text."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                  label="Postprocess URL"
                  value={postprocessConfig.url}
                  onChange={(event) => updatePostprocessConfig({ url: event.target.value })}
                  placeholder="http://llm-host:8000/v1/chat/completions"
                />
                <InputField
                  label="Model"
                  value={postprocessConfig.model}
                  onChange={(event) => updatePostprocessConfig({ model: event.target.value })}
                />
                <InputField
                  label="API Key"
                  type="password"
                  value={postprocessConfig.apiKey}
                  onChange={(event) => updatePostprocessConfig({ apiKey: event.target.value })}
                  placeholder="Optional"
                />
                <InputField
                  label="Timeout (ms)"
                  type="number"
                  value={String(postprocessConfig.timeoutMs)}
                  onChange={(event) =>
                    updatePostprocessConfig({ timeoutMs: Number(event.target.value || 0) })
                  }
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <InputField
                  label="Temperature"
                  type="number"
                  step="0.1"
                  value={String(postprocessConfig.temperature)}
                  onChange={(event) =>
                    updatePostprocessConfig({ temperature: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="Max Tokens"
                  type="number"
                  value={String(postprocessConfig.maxTokens)}
                  onChange={(event) =>
                    updatePostprocessConfig({ maxTokens: Number(event.target.value || 0) })
                  }
                />
                <InputField
                  label="Top P"
                  type="number"
                  step="0.1"
                  value={String(postprocessConfig.topP)}
                  onChange={(event) =>
                    updatePostprocessConfig({ topP: Number(event.target.value || 0) })
                  }
                />
              </div>

              <TextareaField
                label="System Prompt"
                value={postprocessConfig.systemPrompt}
                onChange={(event) =>
                  updatePostprocessConfig({ systemPrompt: event.target.value })
                }
                className="min-h-24"
              />
              <TextareaField
                label="User Prompt"
                value={postprocessConfig.userPrompt}
                onChange={(event) =>
                  updatePostprocessConfig({ userPrompt: event.target.value })
                }
                className="min-h-28"
              />

              <div className="flex flex-wrap gap-3">
                <Toggle
                  checked={postprocessConfig.referenceEnabled}
                  onChange={(checked) => updatePostprocessConfig({ referenceEnabled: checked })}
                  label="Use Reference Text"
                />
                <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-teal">
                  Upload Reference Text
                  <input
                    type="file"
                    accept=".txt,.md"
                    className="hidden"
                    onChange={(event) => void handleReferenceUpload(event, "postprocess")}
                  />
                </label>
              </div>

              <TextareaField
                label="Reference Text"
                value={postprocessConfig.referenceText}
                onChange={(event) =>
                  updatePostprocessConfig({ referenceText: event.target.value })
                }
                className="min-h-28"
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <TextareaField
                  label="Extra Headers JSON"
                  value={postprocessConfig.headersJson}
                  onChange={(event) =>
                    updatePostprocessConfig({ headersJson: event.target.value })
                  }
                  className="min-h-24 font-mono"
                />
                <TextareaField
                  label="Extra Body JSON"
                  value={postprocessConfig.extraBodyJson}
                  onChange={(event) =>
                    updatePostprocessConfig({ extraBodyJson: event.target.value })
                  }
                  className="min-h-24 font-mono"
                />
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Run Controls"
              subtitle="Run each module independently or execute the full pipeline."
            >
              <div className="grid gap-3">
                {(
                  [
                    ["upstage", handleRunUpstage, "Run Upstage DP"],
                    ["vision", handleRunVision, "Run Vision OCR"],
                    ["postprocess", handleRunPostprocess, "Run Postprocess"],
                    ["pipeline", handleRunAll, "Run Full Pipeline"],
                  ] as [StageKey, () => Promise<void>, string][]
                ).map(([key, action, label]) => (
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
                    <StatusPill status={runStatus[key]} />
                  </button>
                ))}
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Stage Status
                </p>
                <div className="mt-3 space-y-3">
                  {(Object.keys(stageLabels) as StageKey[]).map((key) => (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">{stageLabels[key]}</p>
                        <p className="mt-1 text-xs text-slate-500">{runStatus[key].message || "-"}</p>
                      </div>
                      <StatusPill status={runStatus[key]} />
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Presets"
              subtitle="Store the current configuration bundle and load it later."
            >
              <div className="space-y-4">
                <InputField
                  label="Preset Name"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
                <TextareaField
                  label="Description"
                  value={presetDescription}
                  onChange={(event) => setPresetDescription(event.target.value)}
                  className="min-h-20"
                />
                <button
                  type="button"
                  className="w-full rounded-full bg-teal px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  onClick={() => void handleSavePreset()}
                >
                  Save Current Configuration
                </button>
              </div>

              <div className="space-y-3">
                {presets.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No presets saved yet.
                  </div>
                ) : (
                  presets.map((preset) => (
                    <div key={preset.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <p className="font-medium text-ink">{preset.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{preset.description || "No description"}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        Updated {isoToLabel(preset.updatedAt)}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleLoadPreset(preset)}
                          className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUpdatePreset(preset)}
                          className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-coral hover:text-coral"
                        >
                          Overwrite
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeletePreset(preset.id)}
                          className="rounded-full border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Run History"
              subtitle="Reload previous results or restore the configuration that produced them."
            >
              <div className="space-y-3">
                {history.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No history records yet.
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-ink">
                            {item.fileName || "No file"} <span className="text-slate-400">#{item.id}</span>
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {item.runType} · {isoToLabel(item.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleLoadHistory(item)}
                          className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
                        >
                          Load Result
                        </button>
                      </div>
                      {item.roi ? (
                        <p className="mt-3 text-xs text-slate-500">
                          ROI: x {item.roi.x.toFixed(3)} / y {item.roi.y.toFixed(3)} / w{" "}
                          {item.roi.width.toFixed(3)} / h {item.roi.height.toFixed(3)}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="mt-6">
          <SectionCard
            title="Result Comparison"
            subtitle="Inspect Upstage OCR, vision OCR, and final postprocess output side by side."
          >
            <div className="grid gap-4 xl:grid-cols-3">
              <ResultPane
                title="Upstage DP OCR"
                text={resolveUpstageText(results.upstage)}
                raw={results.upstage?.raw}
                statusCode={results.upstage?.statusCode}
                errorMessage={runStatus.upstage.state === "error" ? runStatus.upstage.message : undefined}
              />
              <ResultPane
                title="Vision OCR"
                text={results.vision?.text}
                raw={results.vision?.raw}
                statusCode={results.vision?.statusCode}
                promptPreview={results.vision?.usedPrompt?.compiledPrompt}
                referencePreview={results.vision?.usedReferenceText}
                errorMessage={runStatus.vision.state === "error" ? runStatus.vision.message : undefined}
              />
              <ResultPane
                title="Postprocess Final"
                text={results.postprocess?.text}
                raw={results.postprocess?.raw}
                statusCode={results.postprocess?.statusCode}
                promptPreview={results.postprocess?.usedPrompt?.compiledPrompt}
                referencePreview={results.postprocess?.usedReferenceText}
                errorMessage={
                  runStatus.postprocess.state === "error" ? runStatus.postprocess.message : undefined
                }
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <JsonViewer label="Vision Range Info" data={results.vision?.range || {}} />
              <JsonViewer
                label="Upstage Summary"
                data={{
                  content: results.upstage?.content || {},
                  elements: results.upstage?.elements || [],
                  usage: results.upstage?.usage || {},
                  pageCount: results.upstage?.pageCount || null,
                }}
              />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
