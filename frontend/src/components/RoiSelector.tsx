import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { useAppStore } from "../stores/useAppStore";
import { getImageDimensions, getSupportedFileKind } from "../utils/file";
import { translate } from "../utils/i18n";
import type { Roi } from "../utils/types";

GlobalWorkerOptions.workerSrc = workerUrl;

type RoiSelectorProps = {
  file: File | null;
  page: number;
  onPageChange: (page: number) => void;
  pageCount: number;
  roi: Roi;
  onRoiChange: (roi: Roi) => void;
  enabled: boolean;
};

type DraftRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PreviewDimensions = {
  width: number;
  height: number;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const MAX_PREVIEW_WIDTH = 960;
const MAX_PREVIEW_HEIGHT = 1280;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function normalizePreviewDimensions(dimensions: PreviewDimensions): PreviewDimensions {
  const widthRatio = MAX_PREVIEW_WIDTH / dimensions.width;
  const heightRatio = MAX_PREVIEW_HEIGHT / dimensions.height;
  const scale = Math.min(1, widthRatio, heightRatio);

  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
}

function normalizeDraft(a: { x: number; y: number }, b: { x: number; y: number }): DraftRoi {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function RoiSelector({
  file,
  page,
  onPageChange,
  pageCount,
  roi,
  onRoiChange,
  enabled,
}: RoiSelectorProps) {
  const language = useAppStore((state) => state.language);
  const t = (key: string) => translate(language, key);
  const fileKind = file ? getSupportedFileKind(file) : null;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDimensions, setPreviewDimensions] = useState<PreviewDimensions | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<DraftRoi | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    let localUrl = "";

    async function renderPreview() {
      if (!file) {
        setPreviewUrl("");
        setPreviewDimensions(null);
        setPreviewError("");
        return;
      }

      setLoading(true);
      setPreviewError("");

      try {
        if (fileKind === "pdf") {
          const buffer = await file.arrayBuffer();
          const pdf = await getDocument({ data: buffer }).promise;
          const currentPage = await pdf.getPage(page);
          const viewport = currentPage.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error(t("roi.canvas_error"));
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await currentPage.render({ canvasContext: context, viewport }).promise;
          localUrl = canvas.toDataURL("image/png");
          if (active) {
            setPreviewDimensions(
              normalizePreviewDimensions({
                width: viewport.width,
                height: viewport.height,
              })
            );
          }
        } else {
          const dimensions = await getImageDimensions(file);
          localUrl = URL.createObjectURL(file);
          if (active) {
            setPreviewDimensions(normalizePreviewDimensions(dimensions));
          }
        }

        if (active) {
          setPreviewUrl(localUrl);
        }
      } catch (error) {
        if (active) {
          setPreviewError(error instanceof Error ? error.message : t("roi.preview_error"));
          setPreviewUrl("");
          setPreviewDimensions(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    renderPreview();

    return () => {
      active = false;
      if (fileKind !== "pdf" && localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [file, fileKind, page, language]);

  const visibleRoi = useMemo(() => {
    if (!roi) {
      return null;
    }

    if (!file || fileKind !== "pdf") {
      return roi;
    }

    if (!roi.page || roi.page === page) {
      return roi;
    }

    return null;
  }, [file, fileKind, page, roi]);

  function toNormalized(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp((clientY - rect.top) / rect.height),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled || !canvasRef.current) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    setDragStart(point);
    setDraft({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || !enabled) {
      return;
    }

    event.preventDefault();
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    setDraft(normalizeDraft(dragStart, point));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || !enabled) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const point = toNormalized(event.clientX, event.clientY);
    if (!point) {
      setDragStart(null);
      setDraft(null);
      return;
    }

    const next = normalizeDraft(dragStart, point);
    setDragStart(null);
    setDraft(null);

    if (next.width < 0.01 || next.height < 0.01) {
      return;
    }

    onRoiChange({
      ...next,
      page,
    });
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDragStart(null);
    setDraft(null);
  }

  function changeZoom(nextZoom: number) {
    setZoom(clampZoom(nextZoom));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {fileKind === "pdf" ? (
          <>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              {t("roi.prev_page")}
            </button>
            <span className="text-sm text-slate-600">
              {t("roi.page")} {page} / {pageCount}
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
              onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
            >
              {t("roi.next_page")}
            </button>
          </>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => changeZoom(zoom - ZOOM_STEP)}
          >
            {t("roi.zoom_out")}
          </button>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            {t("roi.zoom")} {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => changeZoom(zoom + ZOOM_STEP)}
          >
            {t("roi.zoom_in")}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => changeZoom(1)}
          >
            {t("roi.reset_zoom")}
          </button>
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 text-xs text-slate-500">{t("roi.selection_hint")}</div>
        <div className="max-h-[42rem] overflow-auto rounded-[20px] border border-dashed border-slate-300 bg-white">
          {loading ? (
            <div className="flex h-80 items-center justify-center text-sm text-slate-500">
              {t("roi.loading_preview")}
            </div>
          ) : previewError ? (
            <div className="flex h-80 items-center justify-center px-6 text-center text-sm text-red-600">
              {previewError}
            </div>
          ) : previewUrl && previewDimensions ? (
            <div className="flex min-h-[24rem] min-w-full items-start justify-center p-4">
              <div
                ref={canvasRef}
                className={`relative shrink-0 select-none rounded-md ${enabled ? "cursor-crosshair" : ""}`}
                style={{
                  width: `${previewDimensions.width * zoom}px`,
                  height: `${previewDimensions.height * zoom}px`,
                  touchAction: enabled ? "none" : "auto",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <img
                  src={previewUrl}
                  alt="preview"
                  draggable={false}
                  className="block h-full w-full select-none rounded-md object-fill"
                />
                {visibleRoi ? (
                  <div
                    className="pointer-events-none absolute border-2 border-coral bg-coral/15"
                    style={{
                      left: `${visibleRoi.x * 100}%`,
                      top: `${visibleRoi.y * 100}%`,
                      width: `${visibleRoi.width * 100}%`,
                      height: `${visibleRoi.height * 100}%`,
                    }}
                  />
                ) : null}
                {draft ? (
                  <div
                    className="pointer-events-none absolute border-2 border-teal bg-teal/15"
                    style={{
                      left: `${draft.x * 100}%`,
                      top: `${draft.y * 100}%`,
                      width: `${draft.width * 100}%`,
                      height: `${draft.height * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-slate-500">
              {t("roi.preview_placeholder")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
