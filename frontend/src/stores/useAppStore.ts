import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  FileMeta,
  HistoryRecord,
  PostprocessConfig,
  PresetRecord,
  StageResponse,
  StoredConfigBundle,
  UpstageConfig,
  VisionConfig,
} from "../utils/types";

const defaultUpstageConfig: UpstageConfig = {
  url: "",
  endpointsUrl: "",
  licenseUrl: "",
  licenseKey: "",
  headersJson: "{}",
  licenseBodyJson: "{}",
  ocrMode: "auto",
  coordinates: true,
  outputFormats: ["text", "html", "markdown"],
  model: "",
  base64Encoding: false,
  timeoutMs: 300000,
  retryCount: 1,
};

const defaultVisionConfig: VisionConfig = {
  url: "",
  apiKey: "",
  model: "",
  systemPrompt: "You are an OCR assistant that extracts text with high fidelity.",
  userPrompt: "Extract the document text accurately.",
  extractionRules: "줄바꿈 유지\n표 구조 유지\n숫자/기호 정확도 우선",
  temperature: 0.1,
  maxTokens: 4000,
  topP: 1,
  headersJson: "{}",
  extraBodyJson: "{}",
  timeoutMs: 300000,
  retryCount: 1,
  referenceEnabled: false,
  referenceText: "",
  rangeMode: "full_document",
  pageRangeStart: 1,
  pageRangeEnd: 1,
  roi: {
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
    page: 1,
  },
};

const defaultPostprocessConfig: PostprocessConfig = {
  url: "",
  apiKey: "",
  model: "",
  systemPrompt: "You merge OCR outputs into the cleanest possible final text.",
  userPrompt: "Compare both OCR results and produce a refined final text.",
  temperature: 0.1,
  maxTokens: 4000,
  topP: 1,
  headersJson: "{}",
  extraBodyJson: "{}",
  timeoutMs: 300000,
  retryCount: 1,
  referenceEnabled: false,
  referenceText: "",
};

type AppStore = {
  upstageConfig: UpstageConfig;
  visionConfig: VisionConfig;
  postprocessConfig: PostprocessConfig;
  fileMeta: FileMeta | null;
  results: {
    upstage: StageResponse | null;
    vision: StageResponse | null;
    postprocess: StageResponse | null;
  };
  presets: PresetRecord[];
  history: HistoryRecord[];
  updateUpstageConfig: (patch: Partial<UpstageConfig>) => void;
  updateVisionConfig: (patch: Partial<VisionConfig>) => void;
  updatePostprocessConfig: (patch: Partial<PostprocessConfig>) => void;
  setFileMeta: (fileMeta: FileMeta | null) => void;
  setStageResult: (stage: "upstage" | "vision" | "postprocess", result: StageResponse | null) => void;
  resetResults: () => void;
  setPresets: (presets: PresetRecord[]) => void;
  setHistory: (history: HistoryRecord[]) => void;
  applyConfigBundle: (config: StoredConfigBundle) => void;
  resetConfigs: () => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      upstageConfig: defaultUpstageConfig,
      visionConfig: defaultVisionConfig,
      postprocessConfig: defaultPostprocessConfig,
      fileMeta: null,
      results: {
        upstage: null,
        vision: null,
        postprocess: null,
      },
      presets: [],
      history: [],
      updateUpstageConfig: (patch) =>
        set((state) => ({
          upstageConfig: {
            ...state.upstageConfig,
            ...patch,
          },
        })),
      updateVisionConfig: (patch) =>
        set((state) => ({
          visionConfig: {
            ...state.visionConfig,
            ...patch,
          },
        })),
      updatePostprocessConfig: (patch) =>
        set((state) => ({
          postprocessConfig: {
            ...state.postprocessConfig,
            ...patch,
          },
        })),
      setFileMeta: (fileMeta) => set({ fileMeta }),
      setStageResult: (stage, result) =>
        set((state) => ({
          results: {
            ...state.results,
            [stage]: result,
          },
        })),
      resetResults: () =>
        set({
          results: {
            upstage: null,
            vision: null,
            postprocess: null,
          },
        }),
      setPresets: (presets) => set({ presets }),
      setHistory: (history) => set({ history }),
      applyConfigBundle: (config) =>
        set({
          upstageConfig: config.upstage,
          visionConfig: config.vision,
          postprocessConfig: config.postprocess,
        }),
      resetConfigs: () =>
        set({
          upstageConfig: defaultUpstageConfig,
          visionConfig: defaultVisionConfig,
          postprocessConfig: defaultPostprocessConfig,
        }),
    }),
    {
      name: "ocr-compare-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        upstageConfig: state.upstageConfig,
        visionConfig: state.visionConfig,
        postprocessConfig: state.postprocessConfig,
      }),
    }
  )
);

export const defaults = {
  upstage: defaultUpstageConfig,
  vision: defaultVisionConfig,
  postprocess: defaultPostprocessConfig,
};
