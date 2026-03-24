import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AppLanguage } from "../utils/i18n";
import type {
  FileMeta,
  HistoryRecord,
  OpendataloaderConfig,
  PostprocessConfig,
  PresetRecord,
  StageResponse,
  StoredConfigBundle,
  UpstageConfig,
  VisionConfig,
  VisionModelConfig,
  VisionModelResult,
  VisionRegistry,
} from "../utils/types";

const JSON_STRING_FIELDS = new Set(["headersJson", "extraBodyJson", "licenseBodyJson"]);
const SENSITIVE_CANONICAL_KEYS = new Set([
  "apikey",
  "xapikey",
  "authorization",
  "proxyauthorization",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearer",
  "clientsecret",
  "licensekey",
  "password",
  "secret",
]);

let visionModelSequence = 0;

function canonicalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveConfigKey(key: string): boolean {
  const canonical = canonicalizeSensitiveKey(key);

  if (SENSITIVE_CANONICAL_KEYS.has(canonical)) {
    return true;
  }

  return /(^|[^a-z0-9])(token|secret|password)([^a-z0-9]|$)/i.test(key);
}

function sanitizePersistedJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.stringify(sanitizePersistedConfig(JSON.parse(value)));
  } catch {
    return value;
  }
}

function sanitizePersistedConfig<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizePersistedConfig(item)) as T;
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>(
    (accumulator, [key, value]) => {
      if (isSensitiveConfigKey(key)) {
        accumulator[key] = "";
        return accumulator;
      }

      if (JSON_STRING_FIELDS.has(key)) {
        accumulator[key] = sanitizePersistedJsonString(value);
        return accumulator;
      }

      accumulator[key] = sanitizePersistedConfig(value);
      return accumulator;
    },
    {}
  ) as T;
}

const defaultUpstageConfig: UpstageConfig = {
  url: "",
  endpointsUrl: "",
  headersJson: "{}",
  ocrMode: "auto",
  coordinates: true,
  outputFormats: ["text", "html", "markdown"],
  model: "document-parse",
  base64Encoding: false,
  timeoutMs: 300000,
  retryCount: 1,
};

const defaultOpendataloaderConfig: OpendataloaderConfig = {
  outputFormats: ["json", "markdown", "html"],
  keepLineBreaks: false,
  useStructTree: false,
  contentSafetyOff: "",
  replaceInvalidChars: "",
};

const defaultVisionConfig: VisionConfig = {
  url: "",
  apiKey: "",
  model: "",
  useHardcodedPrompts: true,
  systemPrompt: "You are an OCR assistant that extracts text with high fidelity.",
  userPrompt: "Extract the document text accurately.",
  extractionRules:
    "Preserve line breaks\nPreserve table structure\nPrioritize number and symbol accuracy",
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
  pageRois: {},
};

const defaultPostprocessConfig: PostprocessConfig = {
  url: "",
  apiKey: "",
  model: "",
  useHardcodedPrompts: true,
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
  includeOpendataloader: false,
  includeUpstage: true,
  includeVision: true,
};

function createVisionModelId(): string {
  visionModelSequence += 1;
  return `vision-model-${Date.now()}-${visionModelSequence}`;
}

function createDefaultVisionLabel(index: number): string {
  return `Vision Model ${index}`;
}

export function getVisionModelDisplayLabel(
  model: Partial<Pick<VisionModelConfig, "label" | "model">> | null | undefined,
  fallbackIndex = 1
): string {
  const label = model?.label?.trim();
  if (label) {
    return label;
  }

  const modelName = model?.model?.trim();
  if (modelName) {
    return modelName;
  }

  return createDefaultVisionLabel(fallbackIndex);
}

export function createVisionModelConfig(
  overrides: Partial<VisionModelConfig> = {},
  fallbackIndex = 1,
  options?: {
    preserveBlankLabel?: boolean;
  }
): VisionModelConfig {
  const id = overrides.id?.trim() || createVisionModelId();
  const model = overrides.model?.trim() || "";
  const label =
    typeof overrides.label === "string"
      ? options?.preserveBlankLabel
        ? overrides.label
        : getVisionModelDisplayLabel({ label: overrides.label, model }, fallbackIndex)
      : getVisionModelDisplayLabel({ model }, fallbackIndex);

  return {
    ...defaultVisionConfig,
    ...overrides,
    id,
    label,
    roi: {
      ...defaultVisionConfig.roi,
      ...(overrides.roi || {}),
    },
    pageRois: overrides.pageRois || {},
  };
}

function createDefaultVisionRegistry(): VisionRegistry {
  const model = createVisionModelConfig();
  return {
    activeModelId: model.id,
    models: [model],
  };
}

function normalizeVisionModels(input: unknown[]): VisionModelConfig[] {
  const seenIds = new Set<string>();

  return input.reduce<VisionModelConfig[]>((accumulator, item, index) => {
    const model = createVisionModelConfig(
      item && typeof item === "object" ? (item as Partial<VisionModelConfig>) : {},
      index + 1
    );

    if (seenIds.has(model.id)) {
      model.id = createVisionModelId();
    }

    seenIds.add(model.id);
    accumulator.push(model);
    return accumulator;
  }, []);
}

export function normalizeVisionRegistry(input: unknown): VisionRegistry {
  if (!input || typeof input !== "object") {
    return createDefaultVisionRegistry();
  }

  const maybeRegistry = input as Partial<VisionRegistry> & Partial<VisionModelConfig>;
  const sourceModels = Array.isArray(maybeRegistry.models)
    ? maybeRegistry.models
    : Object.keys(maybeRegistry).length
      ? [maybeRegistry]
      : [];

  const models = normalizeVisionModels(sourceModels);
  if (!models.length) {
    return createDefaultVisionRegistry();
  }

  const activeModelId = models.some((model) => model.id === maybeRegistry.activeModelId)
    ? String(maybeRegistry.activeModelId)
    : models[0].id;

  return {
    activeModelId,
    models,
  };
}

function syncVisionResultsWithRegistry(
  results: Record<string, VisionModelResult | null> | undefined,
  registry: VisionRegistry
): Record<string, VisionModelResult | null> {
  return registry.models.reduce<Record<string, VisionModelResult | null>>((accumulator, model) => {
    if (results && typeof results === "object" && model.id in results) {
      accumulator[model.id] = results[model.id] || null;
    }

    return accumulator;
  }, {});
}

type AppStore = {
  language: AppLanguage;
  opendataloaderConfig: OpendataloaderConfig;
  upstageConfig: UpstageConfig;
  visionRegistry: VisionRegistry;
  postprocessConfig: PostprocessConfig;
  fileMeta: FileMeta | null;
  results: {
    opendataloader: StageResponse | null;
    upstage: StageResponse | null;
    vision: Record<string, VisionModelResult | null>;
    postprocess: StageResponse | null;
  };
  presets: PresetRecord[];
  history: HistoryRecord[];
  updateOpendataloaderConfig: (patch: Partial<OpendataloaderConfig>) => void;
  updateUpstageConfig: (patch: Partial<UpstageConfig>) => void;
  setVisionRegistry: (visionRegistry: VisionRegistry) => void;
  updateVisionModel: (modelId: string, patch: Partial<VisionModelConfig>) => void;
  addVisionModel: () => string;
  cloneVisionModel: (modelId: string) => string;
  removeVisionModel: (modelId: string) => void;
  setActiveVisionModel: (modelId: string) => void;
  updatePostprocessConfig: (patch: Partial<PostprocessConfig>) => void;
  setFileMeta: (fileMeta: FileMeta | null) => void;
  setStageResult: (
    stage: "opendataloader" | "upstage" | "postprocess",
    result: StageResponse | null
  ) => void;
  setVisionResult: (modelId: string, result: VisionModelResult | null) => void;
  setVisionResults: (results: Record<string, VisionModelResult | null>) => void;
  resetResults: () => void;
  setPresets: (presets: PresetRecord[]) => void;
  setHistory: (history: HistoryRecord[]) => void;
  applyConfigBundle: (config: StoredConfigBundle) => void;
  resetConfigs: () => void;
  setLanguage: (language: AppLanguage) => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      language: "en",
      opendataloaderConfig: defaultOpendataloaderConfig,
      upstageConfig: defaultUpstageConfig,
      visionRegistry: createDefaultVisionRegistry(),
      postprocessConfig: defaultPostprocessConfig,
      fileMeta: null,
      results: {
        opendataloader: null,
        upstage: null,
        vision: {},
        postprocess: null,
      },
      presets: [],
      history: [],
      updateOpendataloaderConfig: (patch) =>
        set((state) => ({
          opendataloaderConfig: {
            ...state.opendataloaderConfig,
            ...patch,
          },
        })),
      updateUpstageConfig: (patch) =>
        set((state) => ({
          upstageConfig: {
            ...state.upstageConfig,
            ...patch,
          },
        })),
      setVisionRegistry: (visionRegistry) =>
        set((state) => {
          const normalized = normalizeVisionRegistry(visionRegistry);
          return {
            visionRegistry: normalized,
            results: {
              ...state.results,
              vision: syncVisionResultsWithRegistry(state.results.vision, normalized),
            },
          };
        }),
      updateVisionModel: (modelId, patch) =>
        set((state) => {
          const registry = state.visionRegistry;
          return {
            visionRegistry: {
              ...registry,
              models: registry.models.map((model) =>
                model.id === modelId
                  ? createVisionModelConfig(
                      {
                        ...model,
                        ...patch,
                        id: model.id,
                      },
                      registry.models.findIndex((entry) => entry.id === model.id) + 1,
                      { preserveBlankLabel: true }
                    )
                  : model
              ),
            },
          };
        }),
      addVisionModel: () => {
        const model = createVisionModelConfig();
        set((state) => ({
          visionRegistry: {
            activeModelId: model.id,
            models: [...state.visionRegistry.models, model],
          },
        }));
        return model.id;
      },
      cloneVisionModel: (modelId) => {
        let clonedId = "";
        set((state) => {
          const source =
            state.visionRegistry.models.find((model) => model.id === modelId) ||
            state.visionRegistry.models[0];
          const clone = createVisionModelConfig(
            {
              ...source,
              id: undefined,
              label: `${getVisionModelDisplayLabel(
                source,
                state.visionRegistry.models.findIndex((model) => model.id === source.id) + 1
              )} Copy`,
            },
            state.visionRegistry.models.length + 1
          );
          clonedId = clone.id;
          return {
            visionRegistry: {
              activeModelId: clone.id,
              models: [...state.visionRegistry.models, clone],
            },
          };
        });
        return clonedId;
      },
      removeVisionModel: (modelId) =>
        set((state) => {
          if (state.visionRegistry.models.length <= 1) {
            return state;
          }

          const models = state.visionRegistry.models.filter((model) => model.id !== modelId);
          const activeModelId =
            state.visionRegistry.activeModelId === modelId
              ? models[0]?.id || ""
              : state.visionRegistry.activeModelId;
          const nextRegistry = {
            activeModelId,
            models,
          };

          return {
            visionRegistry: nextRegistry,
            results: {
              ...state.results,
              vision: syncVisionResultsWithRegistry(state.results.vision, nextRegistry),
            },
          };
        }),
      setActiveVisionModel: (modelId) =>
        set((state) => ({
          visionRegistry: state.visionRegistry.models.some((model) => model.id === modelId)
            ? {
                ...state.visionRegistry,
                activeModelId: modelId,
              }
            : state.visionRegistry,
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
      setVisionResult: (modelId, result) =>
        set((state) => ({
          results: {
            ...state.results,
            vision: {
              ...state.results.vision,
              [modelId]: result,
            },
          },
        })),
      setVisionResults: (results) =>
        set((state) => ({
          results: {
            ...state.results,
            vision: syncVisionResultsWithRegistry(results, state.visionRegistry),
          },
        })),
      resetResults: () =>
        set({
          results: {
            opendataloader: null,
            upstage: null,
            vision: {},
            postprocess: null,
          },
        }),
      setPresets: (presets) => set({ presets }),
      setHistory: (history) => set({ history }),
      applyConfigBundle: (config) => {
        const normalizedVision = normalizeVisionRegistry(config.vision);
        set((state) => ({
          opendataloaderConfig: {
            ...defaultOpendataloaderConfig,
            ...config.opendataloader,
          },
          upstageConfig: {
            ...defaultUpstageConfig,
            ...config.upstage,
          },
          visionRegistry: normalizedVision,
          postprocessConfig: {
            ...defaultPostprocessConfig,
            ...config.postprocess,
          },
          results: {
            ...state.results,
            vision: syncVisionResultsWithRegistry(state.results.vision, normalizedVision),
          },
        }));
      },
      resetConfigs: () =>
        set({
          opendataloaderConfig: defaultOpendataloaderConfig,
          upstageConfig: defaultUpstageConfig,
          visionRegistry: createDefaultVisionRegistry(),
          postprocessConfig: defaultPostprocessConfig,
        }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: "ocr-compare-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        sanitizePersistedConfig({
          language: state.language,
          opendataloaderConfig: state.opendataloaderConfig,
          upstageConfig: state.upstageConfig,
          visionRegistry: state.visionRegistry,
          postprocessConfig: state.postprocessConfig,
        }),
      merge: (persistedState, currentState) => {
        const safeState = sanitizePersistedConfig(
          (persistedState as Partial<AppStore> & { visionConfig?: VisionConfig }) || {}
        ) as Partial<AppStore> & { visionConfig?: VisionConfig };
        const visionRegistry = normalizeVisionRegistry(
          safeState.visionRegistry || safeState.visionConfig || currentState.visionRegistry
        );

        return {
          ...currentState,
          ...safeState,
          opendataloaderConfig: {
            ...defaultOpendataloaderConfig,
            ...(safeState.opendataloaderConfig || currentState.opendataloaderConfig),
          },
          upstageConfig: {
            ...defaultUpstageConfig,
            ...(safeState.upstageConfig || currentState.upstageConfig),
          },
          visionRegistry,
          postprocessConfig: {
            ...defaultPostprocessConfig,
            ...(safeState.postprocessConfig || currentState.postprocessConfig),
          },
          results: {
            ...currentState.results,
            vision: syncVisionResultsWithRegistry(undefined, visionRegistry),
          },
        };
      },
    }
  )
);

export const defaults = {
  opendataloader: defaultOpendataloaderConfig,
  upstage: defaultUpstageConfig,
  vision: defaultVisionConfig,
  visionRegistry: createDefaultVisionRegistry(),
  postprocess: defaultPostprocessConfig,
};
