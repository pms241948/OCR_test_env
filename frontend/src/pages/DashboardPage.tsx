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
import { translate, type AppLanguage } from "../utils/i18n";
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

function createInitialRunStatus(): RunStatusMap {
  return {
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
          ? "border-teal bg-teal text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-teal"
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-white" : "bg-slate-300"}`} />
      {label}
    </button>
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
    return (
      (error.response?.data as { error?: { message?: string } })?.error?.message ||
      error.message
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return translate(language, "errors.unknown");
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

function getStageLabel(language: AppLanguage, stage: StageKey): string {
  const t = (key: string) => translate(language, key);
  switch (stage) {
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

export function DashboardPage() {
  const {
    language,
    setLanguage,
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

  const t = (key: string) => translate(language, key);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [endpointCheckResult, setEndpointCheckResult] = useState<unknown>(null);
  const [licenseResult, setLicenseResult] = useState<unknown>(null);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [runStatus, setRunStatus] = useState<RunStatusMap>(createInitialRunStatus());

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
      alert(t("alerts.unsupported_file"));
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
        setFileMeta(response.file);
      }
    });
  }

  async function handleRunVision() {
    if (!selectedFile) {
      alert(t("alerts.upload_file_first"));
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
    const upstageResult = results.upstage;
    const visionResult = results.vision;

    if (!fileMeta || !upstageResult || !visionResult) {
      alert(t("alerts.run_upstage_and_vision_first"));
      return;
    }

    await executeStage("postprocess", async () => {
      const response = await runPostprocessApi({
        file: fileMeta,
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

  async function handleRegisterLicense() {
    if (!upstageConfig.licenseUrl) {
      alert(t("alerts.enter_license_url"));
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
      setLicenseResult({ error: getErrorMessage(error, language) });
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
    updateVisionConfig({ rangeMode: mode });
  }

  function resetDashboardState() {
    resetConfigs();
    resetResults();
    setEndpointCheckResult(null);
    setLicenseResult(null);
    setRunStatus(createInitialRunStatus());
  }

  const stageActions: [StageKey, () => Promise<void>, string][] = [
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
      <SectionCard title={t("section.file.title")} subtitle={t("section.file.subtitle")}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-teal hover:bg-white">
          <span className="text-base font-medium text-ink">{t("section.file.select")}</span>
          <span className="mt-2 text-sm text-slate-500">{t("section.file.supported")}</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(event) => void handleFileSelection(event.target.files?.[0] || null)}
          />
        </label>

        {fileMeta ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              [t("section.meta.file"), fileMeta.fileName],
              [t("section.meta.size"), formatBytes(fileMeta.fileSize)],
              [t("section.meta.mime"), fileMeta.mimeType],
              [t("section.meta.pages"), String(fileMeta.pageCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
                <p className="mt-2 break-all text-sm font-medium text-ink">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

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
          <InputField
            label={t("field.license_url")}
            value={upstageConfig.licenseUrl}
            onChange={(event) => updateUpstageConfig({ licenseUrl: event.target.value })}
            placeholder="http://dp-server:8080/api/license"
          />
          <InputField
            label={t("field.model")}
            value={upstageConfig.model}
            onChange={(event) => updateUpstageConfig({ model: event.target.value })}
            placeholder={t("common.optional")}
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
          <InputField
            label={t("field.license_key")}
            value={upstageConfig.licenseKey}
            onChange={(event) => updateUpstageConfig({ licenseKey: event.target.value })}
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
            label={t("field.extra_headers_json")}
            value={upstageConfig.headersJson}
            onChange={(event) => updateUpstageConfig({ headersJson: event.target.value })}
            className="min-h-28 font-mono"
          />
          <TextareaField
            label={t("field.license_body_json")}
            value={upstageConfig.licenseBodyJson}
            onChange={(event) => updateUpstageConfig({ licenseBodyJson: event.target.value })}
            className="min-h-28 font-mono"
          />
        </div>

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
            className="rounded-full bg-coral px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
            onClick={() => void handleRegisterLicense()}
          >
            {t("button.register_license")}
          </button>
        </div>

        {endpointCheckResult ? (
          <JsonViewer label={t("json.endpoint_check")} data={endpointCheckResult} />
        ) : null}
        {licenseResult ? <JsonViewer label={t("json.license_result")} data={licenseResult} /> : null}
      </SectionCard>

      <SectionCard title={t("section.vision.title")} subtitle={t("section.vision.subtitle")}>
        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label={t("field.vision_url")}
            value={visionConfig.url}
            onChange={(event) => updateVisionConfig({ url: event.target.value })}
            placeholder="http://vision-host:8000/v1/chat/completions"
          />
          <InputField
            label={t("field.model")}
            value={visionConfig.model}
            onChange={(event) => updateVisionConfig({ model: event.target.value })}
          />
          <InputField
            label={t("field.api_key")}
            type="password"
            value={visionConfig.apiKey}
            onChange={(event) => updateVisionConfig({ apiKey: event.target.value })}
            placeholder={t("common.optional")}
          />
          <InputField
            label={t("field.timeout_ms")}
            type="number"
            value={String(visionConfig.timeoutMs)}
            onChange={(event) =>
              updateVisionConfig({ timeoutMs: Number(event.target.value || 0) })
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
              updateVisionConfig({ temperature: Number(event.target.value || 0) })
            }
          />
          <InputField
            label={t("field.max_tokens")}
            type="number"
            value={String(visionConfig.maxTokens)}
            onChange={(event) => updateVisionConfig({ maxTokens: Number(event.target.value || 0) })}
          />
          <InputField
            label={t("field.top_p")}
            type="number"
            step="0.1"
            value={String(visionConfig.topP)}
            onChange={(event) => updateVisionConfig({ topP: Number(event.target.value || 0) })}
          />
        </div>

        <TextareaField
          label={t("field.system_prompt")}
          value={visionConfig.systemPrompt}
          onChange={(event) => updateVisionConfig({ systemPrompt: event.target.value })}
          className="min-h-24"
        />
        <TextareaField
          label={t("field.user_prompt")}
          value={visionConfig.userPrompt}
          onChange={(event) => updateVisionConfig({ userPrompt: event.target.value })}
          className="min-h-28"
        />
        <TextareaField
          label={t("field.extraction_rules")}
          value={visionConfig.extractionRules}
          onChange={(event) => updateVisionConfig({ extractionRules: event.target.value })}
          className="min-h-24"
        />

        <div className="flex flex-wrap gap-3">
          <Toggle
            checked={visionConfig.referenceEnabled}
            onChange={(checked) => updateVisionConfig({ referenceEnabled: checked })}
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
          onChange={(event) => updateVisionConfig({ referenceText: event.target.value })}
          className="min-h-28"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <TextareaField
            label={t("field.extra_headers_json")}
            value={visionConfig.headersJson}
            onChange={(event) => updateVisionConfig({ headersJson: event.target.value })}
            className="min-h-24 font-mono"
          />
          <TextareaField
            label={t("field.extra_body_json")}
            value={visionConfig.extraBodyJson}
            onChange={(event) => updateVisionConfig({ extraBodyJson: event.target.value })}
            className="min-h-24 font-mono"
          />
        </div>
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
                  ? "border-teal bg-teal text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-teal"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(visionConfig.rangeMode === "page_range" || visionConfig.rangeMode === "page_and_roi") &&
        fileMeta?.mimeType === "application/pdf" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label={t("field.page_start")}
              type="number"
              min="1"
              max={String(fileMeta.pageCount)}
              value={String(visionConfig.pageRangeStart)}
              onChange={(event) =>
                updateVisionConfig({ pageRangeStart: Number(event.target.value || 1) })
              }
            />
            <InputField
              label={t("field.page_end")}
              type="number"
              min="1"
              max={String(fileMeta.pageCount)}
              value={String(visionConfig.pageRangeEnd)}
              onChange={(event) =>
                updateVisionConfig({ pageRangeEnd: Number(event.target.value || 1) })
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
                label={t("field.x")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(visionConfig.roi.x)}
                onChange={(event) => updateRoi({ x: Number(event.target.value || 0) })}
              />
              <InputField
                label={t("field.y")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(visionConfig.roi.y)}
                onChange={(event) => updateRoi({ y: Number(event.target.value || 0) })}
              />
              <InputField
                label={t("field.width")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(visionConfig.roi.width)}
                onChange={(event) => updateRoi({ width: Number(event.target.value || 0.1) })}
              />
              <InputField
                label={t("field.height")}
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(visionConfig.roi.height)}
                onChange={(event) => updateRoi({ height: Number(event.target.value || 0.1) })}
              />
              <InputField
                label={t("field.roi_page")}
                type="number"
                min="1"
                max={String(fileMeta?.pageCount || 1)}
                value={String(visionConfig.roi.page || 1)}
                onChange={(event) => updateRoi({ page: Number(event.target.value || 1) })}
              />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {t("scope.roi_disabled")}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("section.postprocess.title")}
        subtitle={t("section.postprocess.subtitle")}
      >
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
      </SectionCard>
    </div>
  );

  const rightColumn = (
    <div className="space-y-6">
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
            presets.map((preset) => (
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
      </SectionCard>

      <SectionCard title={t("section.history.title")} subtitle={t("section.history.subtitle")}>
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              {t("history.empty")}
            </div>
          ) : (
            history.map((item) => (
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
                  <button
                    type="button"
                    onClick={() => handleLoadHistory(item)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
                  >
                    {t("button.load_result")}
                  </button>
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
      </SectionCard>
    </div>
  );

  const resultsPanel = (
    <div className="mt-6">
      <SectionCard
        title={t("section.results.title")}
        subtitle={t("section.results.subtitle")}
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <ResultPane
            title={t("results.upstage")}
            text={resolveUpstageText(results.upstage)}
            raw={results.upstage?.raw}
            statusCode={results.upstage?.statusCode}
            errorMessage={
              runStatus.upstage.state === "error" ? runStatus.upstage.message : undefined
            }
          />
          <ResultPane
            title={t("results.vision")}
            text={results.vision?.text}
            raw={results.vision?.raw}
            statusCode={results.vision?.statusCode}
            promptPreview={results.vision?.usedPrompt?.compiledPrompt}
            referencePreview={results.vision?.usedReferenceText}
            errorMessage={runStatus.vision.state === "error" ? runStatus.vision.message : undefined}
          />
          <ResultPane
            title={t("results.postprocess")}
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
          <JsonViewer label={t("results.vision_range_info")} data={results.vision?.range || {}} />
          <JsonViewer
            label={t("results.upstage_summary")}
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
  );

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
                          active ? "bg-teal text-white" : "text-slate-600 hover:text-teal"
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

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          {leftColumn}
          {rightColumn}
        </div>

        {resultsPanel}
      </div>
    </div>
  );
}
