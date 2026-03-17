import { useAppStore } from "../stores/useAppStore";
import { downloadText } from "../utils/file";
import { translate } from "../utils/i18n";
import { JsonViewer } from "./JsonViewer";

type ResultPaneProps = {
  title: string;
  text?: string;
  raw?: unknown;
  statusCode?: number;
  promptPreview?: string;
  referencePreview?: string;
  errorMessage?: string;
};

export function ResultPane({
  title,
  text,
  raw,
  statusCode,
  promptPreview,
  referencePreview,
  errorMessage,
}: ResultPaneProps) {
  const value = text || "";
  const language = useAppStore((state) => state.language);
  const t = (key: string) => translate(language, key);

  return (
    <div className="flex min-h-[28rem] flex-col rounded-[26px] border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-xs text-slate-500">
            {statusCode ? `HTTP ${statusCode}` : t("result.not_run")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal hover:text-teal"
            onClick={() => navigator.clipboard.writeText(value)}
            disabled={!value}
          >
            {t("button.copy")}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-coral hover:text-coral"
            onClick={() => downloadText(`${title}.txt`, value)}
            disabled={!value}
          >
            {t("button.download")}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex-1 space-y-3 p-4">
        <textarea
          readOnly
          value={value}
          className="h-64 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-6 text-slate-800 outline-none"
          placeholder={t("result.placeholder")}
        />

        {promptPreview ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t("result.prompt_preview")}
            </p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">
              {promptPreview}
            </pre>
          </div>
        ) : null}

        {referencePreview ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t("result.reference_preview")}
            </p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">
              {referencePreview}
            </pre>
          </div>
        ) : null}

        <JsonViewer label={t("result.raw_json")} data={raw ?? {}} />
      </div>
    </div>
  );
}
