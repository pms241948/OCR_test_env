import { useEffect, useMemo, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { useAppStore } from "../stores/useAppStore";
import { getSupportedFileKind } from "../utils/file";
import { translate } from "../utils/i18n";

GlobalWorkerOptions.workerSrc = workerUrl;

type DocumentPreviewProps = {
  file: File | null;
  pageCount?: number;
  maxPages?: number;
  emptyMessage?: string;
};

type PreviewImage = {
  page: number;
  url: string;
};

export function DocumentPreview({
  file,
  pageCount = 1,
  maxPages = 3,
  emptyMessage,
}: DocumentPreviewProps) {
  const language = useAppStore((state) => state.language);
  const t = (key: string) => translate(language, key);
  const fileKind = file ? getSupportedFileKind(file) : null;
  const [previews, setPreviews] = useState<PreviewImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let imageUrl = "";

    async function loadPreviews() {
      if (!file || !fileKind) {
        setPreviews([]);
        setError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        if (fileKind === "image") {
          imageUrl = URL.createObjectURL(file);
          if (active) {
            setPreviews([{ page: 1, url: imageUrl }]);
          }
          return;
        }

        const buffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: buffer }).promise;
        const pagesToRender = Math.min(pdf.numPages, maxPages);
        const nextPreviews: PreviewImage[] = [];

        for (let currentPageNumber = 1; currentPageNumber <= pagesToRender; currentPageNumber += 1) {
          const pdfPage = await pdf.getPage(currentPageNumber);
          const viewport = pdfPage.getViewport({ scale: 1.05 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error(t("roi.canvas_error"));
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await pdfPage.render({ canvasContext: context, viewport }).promise;
          nextPreviews.push({
            page: currentPageNumber,
            url: canvas.toDataURL("image/png"),
          });
        }

        if (active) {
          setPreviews(nextPreviews);
        }
      } catch (previewError) {
        if (active) {
          setPreviews([]);
          setError(previewError instanceof Error ? previewError.message : t("preview.error"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPreviews();

    return () => {
      active = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [file, fileKind, language, maxPages]);

  const summaryLabel = useMemo(() => {
    if (!file || !fileKind) {
      return "";
    }

    if (fileKind === "image") {
      return language === "ko" ? "업로드한 이미지 미리보기" : "Preview of the uploaded image";
    }

    const shownPages = Math.min(pageCount, maxPages);
    if (language === "ko") {
      return pageCount > shownPages
        ? `총 ${pageCount}페이지 중 앞 ${shownPages}페이지를 표시합니다.`
        : `${pageCount}페이지를 표시합니다.`;
    }

    return pageCount > shownPages
      ? `Showing the first ${shownPages} of ${pageCount} pages.`
      : `Showing ${pageCount} page${pageCount === 1 ? "" : "s"}.`;
  }, [file, fileKind, language, maxPages, pageCount]);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{t("preview.title")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("preview.subtitle")}</p>
        </div>
        {summaryLabel ? (
          <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            {summaryLabel}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 flex min-h-48 items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white px-6 text-sm text-slate-500">
          {t("preview.loading")}
        </div>
      ) : error ? (
        <div className="mt-4 flex min-h-48 items-center justify-center rounded-[24px] border border-dashed border-red-200 bg-white px-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : previews.length > 0 ? (
        <div
          className={`mt-4 grid gap-4 ${
            fileKind === "pdf" ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1"
          }`}
        >
          {previews.map((preview) => (
            <div
              key={`${preview.page}-${preview.url}`}
              className="overflow-hidden rounded-[24px] border border-slate-200 bg-white"
            >
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {fileKind === "pdf"
                    ? `${translate(language, "roi.page")} ${preview.page}`
                    : file?.name}
                </p>
              </div>
              <div className="bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] p-3">
                <img
                  src={preview.url}
                  alt={
                    fileKind === "pdf"
                      ? `${translate(language, "roi.page")} ${preview.page}`
                      : file?.name || "preview"
                  }
                  className={`w-full object-contain ${
                    fileKind === "pdf" ? "max-h-[26rem]" : "max-h-[32rem]"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex min-h-48 items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white px-6 text-sm text-slate-500">
          {emptyMessage || t("preview.empty")}
        </div>
      )}
    </div>
  );
}
