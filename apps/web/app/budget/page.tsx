"use client";

// Budgeting（§5.3）— Budget vs Actual、full-year outlook、各公司達成率。
// Budget master 喺 Supabase（NetSuite 冇 budget 數據）；import/編輯 UI 屬 Phase 2。

import { useState } from "react";
import { ActualVsBudgetBars } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { Card, Seg } from "@/components/ui";
import { OPERATING_SUBS } from "@/lib/dims";
import { useFilters } from "@/lib/filters";
import { hkdCompact, pct } from "@/lib/format";
import { ACTUAL_MONTHS, fyMonthLabel } from "@/lib/fy";
import { pnlRows, pnlTrend } from "@/lib/queries";
import { subsidiaryById } from "@/lib/dims";

const YTD = Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1);
const FULL_YEAR = Array.from({ length: 12 }, (_, i) => i + 1);
const REMAINING = FULL_YEAR.filter((m) => m > ACTUAL_MONTHS);

export default function BudgetPage() {
  const f = useFilters();
  const [metric, setMetric] = useState<"REV" | "NP">("REV");
  const trend = pnlTrend(f.subsidiary, metric).map((d) => ({
    label: fyMonthLabel(d.month),
    actual: d.actual,
    budget: d.budget,
  }));
  const subLabel = f.subsidiary === -1 ? "合併（全集團）" : subsidiaryById(f.subsidiary)?.short ?? "";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">預算 Budgeting</h1>
      <FilterBar />

      <Card
        title={`Budget vs Actual（逐月）— ${subLabel}`}
        subtitle="version = ORIGINAL · HKD"
        right={
          <Seg
            options={[
              { value: "REV", label: "收入" },
              { value: "NP", label: "純利" },
            ]}
            value={metric}
            onChange={setMetric}
          />
        }
      >
        <ActualVsBudgetBars data={trend} />
      </Card>

      <Card
        title="各公司預算達成率（YTD）+ 全年 outlook"
        subtitle="Outlook = 實際 YTD + 預算餘下月份（§5.3）"
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">YTD 收入達成率</th>
                <th className="num">YTD 純利達成率</th>
                <th className="num">全年收入 outlook</th>
                <th className="num">全年收入預算</th>
                <th className="num">Outlook vs 預算</th>
              </tr>
            </thead>
            <tbody>
              {OPERATING_SUBS.map((s) => {
                const ytd = pnlRows(s.id, YTD, false);
                const rest = pnlRows(s.id, REMAINING, false);
                const full = pnlRows(s.id, FULL_YEAR, false);
                const revA = ytd.find((r) => r.code === "TOTAL_REV")!;
                const npA = ytd.find((r) => r.code === "NP")!;
                const outlook = revA.actual + rest.find((r) => r.code === "TOTAL_REV")!.budget;
                const fullBudget = full.find((r) => r.code === "TOTAL_REV")!.budget;
                const gap = outlook / fullBudget - 1;
                const revRate = revA.budget ? revA.actual / revA.budget : 0;
                const npRate = npA.budget ? npA.actual / npA.budget : 0;
                return (
                  <tr key={s.id}>
                    <td className="text-left">{s.short}</td>
                    <td className={`num ${revRate < 1 ? "text-critical" : "text-deltagood"}`}>{pct(revRate, 0)}</td>
                    <td className={`num ${npRate < 1 ? "text-critical" : "text-deltagood"}`}>{pct(npRate, 0)}</td>
                    <td className="num">{hkdCompact(outlook)}</td>
                    <td className="num text-ink2">{hkdCompact(fullBudget)}</td>
                    <td className={`num ${gap < 0 ? "text-critical" : "text-deltagood"}`}>{pct(gap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Budget master 管理（Phase 2）" subtitle="設計已定，等候會計確認 §9.2（ORIGINAL 數字來源及 granularity）">
        <ul className="text-[13px] text-ink2 space-y-1.5 list-disc pl-5">
          <li>Budget 存 Supabase <code className="text-[12px]">budget_lines</code>（FY × version × subsidiary × report_group × 月）；version ∈ {"{ORIGINAL, FORECAST}"}</li>
          <li>xlsx template 上載（行 = report_group、欄 = 12 個月、一 sheet 一公司）+ web 直接編輯，改動寫 audit log</li>
          <li>日後 budget 落到 department 層：schema 已預留 optional 欄</li>
        </ul>
      </Card>
    </div>
  );
}
