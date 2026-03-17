import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<DraftRoi | null>(null);

  useEffect(() => {
    let active = true;
    let localUrl = "";

    async function renderPreview() {
      if (!file) {
        setPreviewUrl("");
        setPreviewError("");
        return;
      }

      setLoading(true);
      setPreviewError("");

      try {
        if (file.type === "application/pdf") {
          const buffer = await file.arrayBuffer();
          const pdf = await getDocument({ data: buffer }).promise;
          const currentPage = await pdf.getPage(page);
          const viewport = currentPage.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error("캔버스를 초기화하지 못했습니다.");
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await currentPage.render({ canvasContext: context, viewport }).promise;
          localUrl = canvas.toDataURL("image/png");
        } else {
          localUrl = URL.createObjectURL(file);
        }

        if (active) {
          setPreviewUrl(localUrl);
        }
      } catch (error) {
        if (active) {
          setPreviewError(error instanceof Error ? error.message : "미리보기를 생성하지 못했습니다.");
          setPreviewUrl("");
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
      if (file && file.type !== "application/pdf" && localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [file, page]);

  const visibleRoi = useMemo(() => {
    if (!roi) {
      return null;
    }

    if (!file || file.type !== "application/pdf") {
      return roi;
    }

    if (!roi.page || roi.page === page) {
      return roi;
    }

    return null;
  }, [file, page, roi]);

  function toNormalized(clientX: number, clientY: number) {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp((clientY - rect.top) / rect.height),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled || !imageRef.current) {
      return;
    }

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

  return (
    <div className="space-y-3">
      {file?.type === "application/pdf" ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            이전 페이지
          </button>
          <span className="text-sm text-slate-600">
            페이지 {page} / {pageCount}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
          >
            다음 페이지
          </button>
        </div>
      ) : null}

      <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-3">
        <div
          className="relative overflow-hidden rounded-[20px] border border-dashed border-slate-300 bg-white"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {loading ? (
            <div className="flex h-80 items-center justify-center text-sm text-slate-500">
              미리보기를 생성하는 중입니다.
            </div>
          ) : previewError ? (
            <div className="flex h-80 items-center justify-center px-6 text-center text-sm text-red-600">
              {previewError}
            </div>
          ) : previewUrl ? (
            <>
              <img
                ref={imageRef}
                src={previewUrl}
                alt="preview"
                className="mx-auto max-h-[32rem] w-full object-contain"
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
            </>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-slate-500">
              업로드한 파일 미리보기가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
