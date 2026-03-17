type JsonViewerProps = {
  label: string;
  data: unknown;
  defaultOpen?: boolean;
};

export function JsonViewer({ label, data, defaultOpen = false }: JsonViewerProps) {
  return (
    <details
      open={defaultOpen}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950/95 text-slate-100"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-100">
        {label}
      </summary>
      <pre className="max-h-[22rem] overflow-auto border-t border-white/10 px-4 py-4 text-xs leading-6">
        {JSON.stringify(data ?? {}, null, 2)}
      </pre>
    </details>
  );
}
