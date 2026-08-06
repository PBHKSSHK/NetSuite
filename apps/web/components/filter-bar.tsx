"use client";

import { useFilters } from "@/lib/filters";
import { SUBSIDIARIES } from "@/lib/dims";
import { ACTUAL_MONTHS, fyMonthFull, periodLabel } from "@/lib/fy";
import { Seg } from "./ui";

export function FilterBar({ showAllocToggle = false }: { showAllocToggle?: boolean }) {
  const f = useFilters();
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <select
        value={f.subsidiary}
        onChange={(e) => f.setSubsidiary(Number(e.target.value))}
        className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]"
        aria-label="選擇公司"
      >
        <option value={-1}>合併（全集團）</option>
        {SUBSIDIARIES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.short}
            {s.isElimination ? "（抵銷）" : ""}
          </option>
        ))}
      </select>

      <Seg
        options={[
          { value: "month", label: "月" },
          { value: "quarter", label: "季" },
          { value: "ytd", label: "YTD" },
        ]}
        value={f.mode}
        onChange={f.setMode}
      />

      <select
        value={f.month}
        onChange={(e) => f.setMonth(Number(e.target.value))}
        className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]"
        aria-label="選擇月份"
      >
        {Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {fyMonthFull(m)}
          </option>
        ))}
      </select>

      <span className="text-[12px] text-ink3">期間：{periodLabel(f.mode, f.month)}</span>

      {showAllocToggle && (
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={f.allocated}
            onChange={(e) => f.setAllocated(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          分攤後（pro-forma）
        </label>
      )}
    </div>
  );
}
