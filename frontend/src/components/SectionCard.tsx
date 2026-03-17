import type { PropsWithChildren, ReactNode } from "react";

type SectionCardProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: ReactNode;
}>;

export function SectionCard({ title, subtitle, action, children }: SectionCardProps) {
  return (
    <section className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel backdrop-blur">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate/70">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
