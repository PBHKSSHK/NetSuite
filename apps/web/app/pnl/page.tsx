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
import { CLIENT_INFO, CLIENT_REVENUE } from "@/lib/store";
import { fyMonthFull } from "@/lib/fy";

/** 揀選期間+公司嘅每客開票貢獻（top 12 + 其餘合計）。
 *  以 invoice 總額計——同 GL 收入行可能有細微差異（invoice 或含非收入項）。 */
function clientContribution(subSel: number, months: number[], totalRev: number) {
  const yms = new Set(months.map((m) => fyMonthFull(m)));
  const info = new Map(CLIENT_INFO.map((c) => [c.customerId, c]));
  const byClient = new Map<number, number>();
  for (const r of CLIENT_REVENUE) {
    if (!yms.has(r.ym)) continue;
    if (subSel !== -1 && r.subsidiaryId !== subSel) continue;
    byClient.set(r.customerId, (byClient.get(r.customerId) ?? 0) + r.amount);
  }
  const all = [...byClient.entries()]
    .map(([id, amount]) => ({
      name: info.get(id)?.name ?? `客戶 #${id}`,
      isRelated: info.get(id)?.isRelated ?? false,
      amount: Math.round(amount),
      sharePct: totalRev ? (100 * amount) / totalRev : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const top = all.slice(0, 12);
  const rest = all.slice(12);
  if (rest.length) {
    const restAmt = rest.reduce((a, r) => a + r.amount, 0);
    top.push({ name: `其餘 ${rest.length} 個客`, isRelated: false, amount: restAmt, sharePct: totalRev ? (100 * restAmt) / totalRev : 0 });
  }
  return top;
}

export default function PnLPage() {
  const f = useFilters();
  const [metric, setMetric] = useState<"REV" | "GP" | "AGI" | "NP">("NP");
  const [showClients, setShowClients] = useState(false);
  const rows = pnlRows(f.subsidiary, f.months, f.allocated);
  const revTotal = rows.find((r) => r.code === "TOTAL_REV")?.actual ?? 0;
  const clientBreakdown = clientContribution(f.subsidiary, f.months, revTotal);
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
                const isRevTotal = r.code === "TOTAL_REV";
                return (
                  <>
                    <tr key={r.code} className={r.kind === "subtotal" ? "subtotal" : ""}>
                      <td className={`text-left ${r.kind === "group" ? "pl-5 text-ink2" : ""}`}>
                        {r.label}
                        {isRevTotal && (
                          <button
                            onClick={() => setShowClients((v) => !v)}
                            className="ml-2 text-[11px] text-accent hover:underline font-normal"
                          >
                            {showClients ? "▾ 收起客戶" : "▸ 按客戶睇"}
                          </button>
                        )}
                      </td>
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
                    {isRevTotal &&
                      showClients &&
                      clientBreakdown.map((c) => (
                        <tr key={`cl-${c.name}`} className="bg-ink3/5">
                          <td className="text-left pl-8 text-[12px] text-ink2">{c.name}</td>
                          <td className="num text-[12px]">{hkd(c.amount)}</td>
                          <td className="num text-[12px] text-ink3" colSpan={3}>
                            佔收入 {c.sharePct.toFixed(1)}%
                          </td>
                          <td className="num text-[12px] text-ink3">{c.isRelated ? "集團內" : ""}</td>
                        </tr>
                      ))}
                  </>
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
