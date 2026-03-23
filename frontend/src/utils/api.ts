import axios from "axios";

import type {
  HistoryRecord,
  PostprocessConfig,
  PresetRecord,
  StageResponse,
  StoredConfigBundle,
  UpstageConfig,
  VisionModelConfig,
  FileMeta,
} from "./types";

const api = axios.create({
  baseURL: "/api",
});

function unwrap<T>(response: { data: { success: boolean; data: T } }): T {
  return response.data.data;
}

export async function runUpstageApi(file: File, config: UpstageConfig): Promise<StageResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("config", JSON.stringify(config));
  const response = await api.post("/ocr/upstage", formData);
  return unwrap<{ file: FileMeta } & StageResponse>(response);
}

export async function testUpstageCallApi(config: UpstageConfig): Promise<unknown> {
  const response = await api.post("/ocr/upstage/test-call", config);
  return unwrap(response);
}

export async function runVisionApi(file: File, config: VisionModelConfig): Promise<StageResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("config", JSON.stringify(config));
  const response = await api.post("/ocr/vision-llm", formData);
  return unwrap<{ file: FileMeta } & StageResponse>(response);
}

export async function testVisionCallApi(config: VisionModelConfig): Promise<unknown> {
  const response = await api.post("/ocr/vision-llm/test-call", config);
  return unwrap(response);
}

export async function runPostprocessApi(payload: {
  file: FileMeta;
  upstageResult: StageResponse;
  visionResult: StageResponse;
  config: PostprocessConfig;
}): Promise<StageResponse> {
  const response = await api.post("/postprocess", payload);
  return unwrap<StageResponse>(response);
}

export async function testPostprocessCallApi(payload: {
  config: PostprocessConfig;
}): Promise<unknown> {
  const response = await api.post("/postprocess/test-call", payload);
  return unwrap(response);
}

export async function runAllApi(
  file: File,
  config: StoredConfigBundle
): Promise<{
  file: FileMeta;
  upstage: StageResponse;
  vision: StageResponse;
  postprocess: StageResponse;
}> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("config", JSON.stringify(config));
  const response = await api.post("/run-all", formData);
  return unwrap(response);
}

export async function checkUpstageEndpointsApi(payload: {
  url: string;
  headersJson?: string;
  timeoutMs?: number;
  retryCount?: number;
}): Promise<{ statusCode: number; raw: unknown }> {
  const response = await api.post("/upstage/check-endpoints", payload);
  return unwrap(response);
}

export async function fetchHistoryApi(): Promise<HistoryRecord[]> {
  const response = await api.get("/history");
  return unwrap(response);
}

export async function deleteHistoryApi(id: number): Promise<void> {
  await api.delete(`/history/${id}`);
}

export async function fetchPresetsApi(): Promise<PresetRecord[]> {
  const response = await api.get("/presets");
  return unwrap(response);
}

export async function createPresetApi(payload: {
  name: string;
  description: string;
  config: StoredConfigBundle;
}): Promise<void> {
  await api.post("/presets", payload);
}

export async function updatePresetApi(
  id: number,
  payload: {
    name: string;
    description: string;
    config: StoredConfigBundle;
  }
): Promise<void> {
  await api.put(`/presets/${id}`, payload);
}

export async function deletePresetApi(id: number): Promise<void> {
  await api.delete(`/presets/${id}`);
}
