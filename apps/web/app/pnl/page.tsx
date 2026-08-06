"use client";

// P&L（§5.1）— report_group 行項、Actual|Budget|Var|LY 欄、12 個月 trend、
// 分攤前/後 toggle。

import { useState } from "react";
import { MonthTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { Card, ExportButton, Seg, exportCsv } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { hkd, hkdCompact, pct, variancePct } from "@/lib/format";
import { fyMonthLabel, periodLabel } from "@/lib/fy";
import { allocationForPeriod, pnlRows, pnlTrend } from "@/lib/queries";
import { subsidiaryById } from "@/lib/dims";

export default function PnLPage() {
  const f = useFilters();
  const [metric, setMetric] = useState<"REV" | "GP" | "AGI" | "NP">("NP");
  const rows = pnlRows(f.subsidiary, f.months, f.allocated);
  const trend = pnlTrend(f.subsidiary, metric).map((d) => ({ label: fyMonthLabel(d.month), ...d }));
  const alloc = f.allocated && f.subsidiary !== -1 ? allocationForPeriod(f.months, "actual") : null;

  const subLabel = f.subsidiary === -1 ? "合併（全集團）" : subsidiaryById(f.subsidiary)?.short ?? "";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">損益表 P&L</h1>
      <FilterBar showAllocToggle />

      <Card
        title={`P&L — ${subLabel}`}
        subtitle={`${periodLabel(f.mode, f.month)} · HKD${f.allocated ? " · 已套用 pro-forma 分攤（不改 NetSuite 帳）" : ""}`}
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `pnl_${subLabel}_${periodLabel(f.mode, f.month)}.csv`,
                ["行項", "實際", "預算", "差異", "差異%", "去年"],
                rows.map((r) => [r.label, Math.round(r.actual), Math.round(r.budget), Math.round(r.actual - r.budget), r.budget ? (((r.actual - r.budget) / Math.abs(r.budget)) * 100).toFixed(1) + "%" : "", Math.round(r.ly)])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">行項</th>
                <th className="num">實際</th>
                <th className="num">預算</th>
                <th className="num">差異</th>
                <th className="num">差異 %</th>
                <th className="num">去年</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const varAmt = r.actual - r.budget;
                const varP = variancePct(r.actual, r.budget);
                // favourable: income rows above budget / expense rows below budget
                const favourable = r.sign === 1 ? varAmt >= 0 : varAmt <= 0;
                return (
                  <tr key={r.code} className={r.kind === "subtotal" ? "subtotal" : ""}>
                    <td className={`text-left ${r.kind === "group" ? "pl-5 text-ink2" : ""}`}>{r.label}</td>
                    <td className="num">{hkd(r.actual)}</td>
                    <td className="num text-ink2">{hkd(r.budget)}</td>
                    <td className={`num ${Math.abs(varAmt) < 1 ? "text-ink3" : favourable ? "text-deltagood" : "text-critical"}`}>
                      {hkdCompact(varAmt)}
                    </td>
                    <td className={`num ${varP == null ? "text-ink3" : favourable ? "text-deltagood" : "text-critical"}`}>
                      {varP == null ? "—" : pct(varP)}
                    </td>
                    <td className="num text-ink2">{hkd(r.ly)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          AGI 定義（旅遊收入是否計入）待會計於 mapping 確認（blueprint §9.1）；行項分組 production 由會計喺 admin UI 維護。
        </p>
      </Card>

      {alloc && (
        <Card title="分攤明細（pro-forma）" subtitle="Photoblog dept 6/9/11 成本，按其餘四公司毛利比例分攤（§5.5）">
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">公司</th>
                  <th className="num">GP 佔比</th>
                  <th className="num">獲分攤金額（本期）</th>
                </tr>
              </thead>
              <tbody>
                {alloc.gpShares.map((g) => (
                  <tr key={g.sub}>
                    <td className="text-left">{subsidiaryById(g.sub)?.short}</td>
                    <td className="num">{pct(g.share)}</td>
                    <td className="num">{hkd(alloc.bySub[g.sub] ?? 0)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td className="text-left">Photoblog（分攤出）</td>
                  <td className="num">—</td>
                  <td className="num">{hkd(alloc.bySub[1] ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="12 個月 trend"
        subtitle="實際（已關帳月份）vs 預算 vs 去年"
        right={
          <Seg
            options={[
              { value: "REV", label: "收入" },
              { value: "GP", label: "毛利" },
              { value: "AGI", label: "AGI" },
              { value: "NP", label: "純利" },
            ]}
            value={metric}
            onChange={setMetric}
          />
        }
      >
        <MonthTrendChart data={trend} />
      </Card>
    </div>
  );
}
