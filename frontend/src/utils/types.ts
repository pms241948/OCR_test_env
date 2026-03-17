export type RangeMode = "full_document" | "page_range" | "roi" | "page_and_roi";

export type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
};

export type PageRoiMap = Record<string, Roi>;

export type FileMeta = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  pageCount: number;
  width?: number | null;
  height?: number | null;
  fileHash?: string | null;
};

export type UploadedDocument = {
  id: string;
  file: File;
  meta: FileMeta;
};

export type UpstageConfig = {
  url: string;
  endpointsUrl: string;
  headersJson: string;
  ocrMode: "auto" | "force";
  coordinates: boolean;
  outputFormats: string[];
  base64Encoding: boolean;
  timeoutMs: number;
  retryCount: number;
};

export type LlmBaseConfig = {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  headersJson: string;
  extraBodyJson: string;
  timeoutMs: number;
  retryCount: number;
  referenceEnabled: boolean;
  referenceText: string;
};

export type VisionConfig = LlmBaseConfig & {
  extractionRules: string;
  rangeMode: RangeMode;
  pageRangeStart: number;
  pageRangeEnd: number;
  roi: Roi;
  pageRois?: PageRoiMap;
};

export type PostprocessConfig = LlmBaseConfig;

export type StoredConfigBundle = {
  upstage: UpstageConfig;
  vision: VisionConfig;
  postprocess: PostprocessConfig;
};

export type PresetRecord = {
  id: number;
  name: string;
  description: string;
  config: StoredConfigBundle;
  createdAt: string;
  updatedAt: string;
};

export type HistoryRecord = {
  id: number;
  runType: string;
  fileName: string;
  fileHash?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  filePages?: number | null;
  config: unknown;
  roi: Roi | null;
  result: unknown;
  createdAt: string;
};

export type StageResponse = {
  historyId?: number;
  file?: FileMeta;
  stage?: string;
  statusCode: number;
  content?: {
    text?: string;
    html?: string;
    markdown?: string;
  };
  text?: string;
  raw?: unknown;
  usedPrompt?: {
    systemPrompt?: string;
    userPrompt?: string;
    compiledPrompt?: string;
    extractionRules?: string;
  };
  usedReferenceText?: string;
  request?: unknown;
  range?: {
    mode: RangeMode;
    pages: number[];
    roi: Roi | null;
    pageRois?: PageRoiMap | null;
  };
  elements?: unknown[];
  usage?: unknown;
  pageCount?: number | null;
};

export type StageKey = "upstage" | "vision" | "postprocess" | "pipeline";
