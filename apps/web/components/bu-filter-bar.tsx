"use client";

import { Seg } from "./ui";
import { useBuFilters } from "@/lib/bu-filters";
import { FM_LABEL, periodLabelOf, ymOf } from "@/lib/bu";
import { ALLOC_RULES } from "@/lib/bu-store";

export function BuFilterBar({ showLayer = false, showAlloc = false }: { showLayer?: boolean; showAlloc?: boolean }) {
  const f = useBuFilters();
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <select value={f.fy} onChange={(e) => f.setFy(e.target.value)} className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]" aria-label="選擇財年">
        {f.fys.map((fy) => (
          <option key={fy} value={fy}>
            {fy}
          </option>
        ))}
      </select>
      <Seg
        options={[
          { value: "month", label: "月" },
          { value: "quarter", label: "季" },
          { value: "ytd", label: "YTD" },
          { value: "full", label: "全年" },
        ]}
        value={f.mode}
        onChange={f.setMode}
      />
      {f.mode !== "full" && (
        <select value={f.month} onChange={(e) => f.setMonth(Number(e.target.value))} className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]" aria-label="選擇月份">
          {Array.from({ length: f.lastMonth }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {ymOf(f.fy, m)}（{FM_LABEL[m - 1]}）
            </option>
          ))}
        </select>
      )}
      <span className="text-[12px] text-ink3">期間：{periodLabelOf(f.period)}</span>

      {(showLayer || showAlloc) && <span className="hidden md:inline-block w-px h-5 bg-grid mx-1" aria-hidden />}

      {showLayer && (
        <Seg
          options={[
            { value: 1, label: "純業務（Layer 1）" },
            { value: 2, label: "分攤後（Layer 2）" },
          ]}
          value={f.layer}
          onChange={f.setLayer}
        />
      )}
      {showAlloc && (
        <>
          <select
            value={f.allocKey}
            onChange={(e) => f.setAllocKey(e.target.value as typeof f.allocKey)}
            className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]"
            aria-label="分攤方法"
            disabled={showLayer && f.layer === 1}
          >
            {ALLOC_RULES.map((r) => (
              <option key={r.ruleId} value={r.keyType}>
                分攤：{r.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-ink2 cursor-pointer select-none">
            <input type="checkbox" checked={f.netAssocFee} onChange={(e) => f.setNetAssocFee(e.target.checked)} className="accent-[var(--accent)]" />
            扣 Go Asia / JS admin fee
          </label>
        </>
      )}
    </div>
  );
}
