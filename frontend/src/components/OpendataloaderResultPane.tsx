import React, { useEffect, useMemo, useState } from "react";

import { useAppStore } from "../stores/useAppStore";
import { downloadBlob, downloadText } from "../utils/file";
import { translate } from "../utils/i18n";
import type { DownloadableResultFile, StageResponse } from "../utils/types";
import { JsonViewer } from "./JsonViewer";

type ViewMode = "structured" | "plain" | "html" | "markdown";

type OpendataloaderResultPaneProps = {
  title: string;
  result: StageResponse | null;
  statusCode?: number;
  errorMessage?: string;
  downloads?: DownloadableResultFile[];
  className?: string;
  textareaClassName?: string;
  contentClassName?: string;
  rawDefaultOpen?: boolean;
};

function cn(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function buildHtmlDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        padding: 24px;
        color: #1f2937;
        background: #ffffff;
        line-height: 1.7;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border: 1px solid #cbd5e1;
        padding: 8px 10px;
        vertical-align: top;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      pre {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>${html || "<p></p>"}</body>
</html>`;
}

export function OpendataloaderResultPane({
  title,
  result,
  statusCode,
  errorMessage,
  downloads = [],
  className,
  textareaClassName,
  contentClassName,
  rawDefaultOpen = false,
}: OpendataloaderResultPaneProps) {
  const language = useAppStore((state) => state.language);
  const t = (key: string) => translate(language, key);
  const structuredText = result?.content?.structuredText || result?.text || "";
  const plainText = result?.content?.plainText || result?.content?.text || structuredText;
  const html = result?.content?.html || "";
  const markdown = result?.content?.markdown || "";
  const views = useMemo(
    () =>
      [
        {
          key: "structured" as const,
          label: t("opendataloader.view.structured"),
          available: Boolean(structuredText),
        },
        {
          key: "plain" as const,
          label: t("opendataloader.view.plain"),
          available: Boolean(plainText),
        },
        {
          key: "html" as const,
          label: t("opendataloader.view.html"),
          available: Boolean(html),
        },
        {
          key: "markdown" as const,
          label: t("opendataloader.view.markdown"),
          available: Boolean(markdown),
        },
      ].filter((view) => view.available),
    [html, markdown, plainText, structuredText, t]
  );
  const [activeView, setActiveView] = useState<ViewMode>("structured");

  useEffect(() => {
    if (views.some((view) => view.key === activeView)) {
      return;
    }

    setActiveView((views[0]?.key || "structured") as ViewMode);
  }, [activeView, views]);

  const selectedText =
    activeView === "markdown"
      ? markdown
      : activeView === "html"
        ? plainText || structuredText
        : activeView === "plain"
          ? plainText
          : structuredText;
  const frameDocument = useMemo(() => buildHtmlDocument(html), [html]);

  return (
    <div
      className={cn(
        "flex min-h-[28rem] flex-col rounded-[26px] border border-slate-200 bg-white",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-xs text-slate-500">
            {statusCode ? `HTTP ${statusCode}` : t("result.not_run")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => navigator.clipboard.writeText(selectedText)}
            disabled={!selectedText}
          >
            {t("button.copy")}
          </button>
          {downloads.length === 0 ? (
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-coral hover:text-coral"
              onClick={() => downloadText(`${title}.txt`, selectedText)}
              disabled={!selectedText}
            >
              {t("button.download")}
            </button>
          ) : null}
          {downloads.map((download) => (
            <button
              key={download.key}
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-coral hover:text-coral"
              onClick={() => downloadBlob(download.fileName, download.content, download.mimeType)}
              disabled={!download.content}
            >
              {download.label}
            </button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className={cn("flex-1 space-y-3 p-4", contentClassName)}>
        {views.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {views.map((view) => {
              const active = activeView === view.key;
              return (
                <button
                  key={view.key}
                  type="button"
                  onClick={() => setActiveView(view.key)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "border-ink bg-ink text-white shadow-sm"
                      : "border-slate-300 bg-white text-slate-700 hover:border-ink hover:text-ink"
                  }`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {activeView === "html" && html ? (
          <iframe
            title={`${title} HTML Preview`}
            sandbox=""
            srcDoc={frameDocument}
            className={cn(
              "h-64 w-full rounded-2xl border border-slate-200 bg-white",
              textareaClassName
            )}
          />
        ) : activeView === "markdown" && markdown ? (
          <pre
            className={cn(
              "h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-6 text-slate-800",
              textareaClassName
            )}
          >
            {markdown}
          </pre>
        ) : (
          <textarea
            readOnly
            value={selectedText}
            spellCheck={false}
            className={cn(
              "h-64 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-6 text-slate-800 outline-none",
              textareaClassName
            )}
            placeholder={t("result.placeholder")}
          />
        )}

        <JsonViewer label={t("result.raw_json")} data={result?.raw ?? {}} defaultOpen={rawDefaultOpen} />
      </div>
    </div>
  );
}
