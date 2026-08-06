"use client";

import { hkdCompact, signedPct } from "@/lib/format";

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-surface rounded-xl border border-ringc shadow-sm ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-1">
          <div>
            {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-[11px] text-ink3 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="px-4 pb-4 pt-1">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  goodWhenUp = true,
  note,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  goodWhenUp?: boolean;
  note?: string;
}) {
  const good = delta != null && (delta >= 0) === goodWhenUp;
  return (
    <div className="bg-surface rounded-xl border border-ringc shadow-sm px-4 py-3.5">
      <div className="text-[12px] text-ink2">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {delta != null && (
        <div className={`text-[12px] mt-1 ${good ? "text-deltagood" : "text-critical"}`}>
          {signedPct(delta)} {deltaLabel && <span className="text-ink3">{deltaLabel}</span>}
        </div>
      )}
      {note && <div className="text-[11px] text-ink3 mt-1">{note}</div>}
    </div>
  );
}

const SEVERITY_STYLE: Record<string, { dot: string; label: string }> = {
  critical: { dot: "bg-critical", label: "嚴重" },
  serious: { dot: "bg-serious", label: "注意" },
  warning: { dot: "bg-warn", label: "提示" },
  good: { dot: "bg-good", label: "正常" },
};

export function AlertRow({ severity, title, detail }: { severity: string; title: string; detail: string }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.warning;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-grid last:border-b-0">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="text-[13px] font-medium">
          <span className="text-ink3 mr-1.5 text-[11px]">[{s.label}]</span>
          {title}
        </div>
        <div className="text-[12px] text-ink2">{detail}</div>
      </div>
    </div>
  );
}

/** amount cell with favourable/unfavourable colouring for variance columns */
export function VarCell({ value, favourable }: { value: number; favourable: boolean }) {
  return (
    <td className={`num ${value === 0 ? "text-ink3" : favourable ? "text-deltagood" : "text-critical"}`}>
      {hkdCompact(value)}
    </td>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-ringc bg-surface p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
            o.value === value ? "bg-accent text-white font-medium" : "text-ink2 hover:bg-ink3/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** simple client-side CSV export (xlsx via SheetJS is a Phase 2 item) */
export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[12px] text-ink2 border border-ringc rounded-md px-2.5 py-1 hover:bg-ink3/10 shrink-0"
    >
      ⬇ 匯出 CSV
    </button>
  );
}
