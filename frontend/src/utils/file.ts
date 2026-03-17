import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { FileMeta } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

type SupportedFileKind = "pdf" | "image" | null;

function getLowercaseExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function getSupportedFileKind(file: Pick<File, "name" | "type">): SupportedFileKind {
  const mimeType = file.type.toLowerCase();
  const extension = getLowercaseExtension(file.name);

  if (mimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg"
  ) {
    return "image";
  }

  return null;
}

export function getNormalizedMimeType(file: Pick<File, "name" | "type">): string {
  const kind = getSupportedFileKind(file);

  if (kind === "pdf") {
    return "application/pdf";
  }

  if (kind === "image") {
    const extension = getLowercaseExtension(file.name);
    return extension === "png" ? "image/png" : "image/jpeg";
  }

  return file.type;
}

export async function getLocalFileMeta(file: File): Promise<FileMeta> {
  const kind = getSupportedFileKind(file);
  const meta: FileMeta = {
    fileName: file.name,
    fileSize: file.size,
    mimeType: getNormalizedMimeType(file),
    pageCount: 1,
  };

  if (kind === "pdf") {
    const buffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: buffer }).promise;
    meta.pageCount = pdf.numPages;
    return meta;
  }

  if (kind === "image") {
    const dimensions = await getImageDimensions(file);
    meta.width = dimensions.width;
    meta.height = dimensions.height;
    return meta;
  }

  throw new Error("Unsupported file type.");
}

export function formatBytes(bytes: number): string {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export async function readTextFile(file: File): Promise<string> {
  return file.text();
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const src = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      URL.revokeObjectURL(src);
    };
    image.onerror = () => {
      reject(new Error("Failed to load the image preview."));
      URL.revokeObjectURL(src);
    };
    image.src = src;
  });
}

export function isoToLabel(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}
