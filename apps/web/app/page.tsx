"use client";

// 集團總覽 — landing page (blueprint §6.1 owner view + §6.2 agency KPIs + §6.5 alerts)

import Link from "next/link";
import { BankTrendChart, MonthTrendChart } from "@/components/charts";
import { AlertRow, Card, StatTile } from "@/components/ui";
import { BANK_TODAY } from "@/lib/demo";
import { OPERATING_SUBS } from "@/lib/dims";
import { hkdCompact, pct, variancePct } from "@/lib/format";
import { ACTUAL_MONTHS, fyMonthLabel } from "@/lib/fy";
import {
  ageBuckets,
  alerts,
  arItems,
  bankTrend,
  concentration,
  dso,
  groupBankTotal,
  kpiAgi,
  pnlRows,
  pnlTrend,
  sumFacts,
} from "@/lib/queries";
import { CURRENT_FY, PRIOR_FY } from "@/lib/fy";

const YTD = Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1);

export default function OverviewPage() {
  const bank = bankTrend().map((d) => ({ label: d.date.slice(5), total: d.total }));
  const npTrend = pnlTrend(-1, "NP").map((d) => ({ label: fyMonthLabel(d.month), ...d }));
  const kpi = kpiAgi(-1, YTD);
  const conc = concentration();
  const consolRows = pnlRows(-1, YTD, false);
  const rev = consolRows.find((r) => r.code === "TOTAL_REV")!;
  const gp = consolRows.find((r) => r.code === "GP")!;
  const np = consolRows.find((r) => r.code === "NP")!;
  const alertList = alerts();
  const arB = ageBuckets(arItems(-1));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">集團總覽 · FY2026/27 YTD（4–7 月）</h1>
        <Link href="/pnl" className="text-[12px] text-accent hover:underline">
          查看完整 P&L →
        </Link>
      </div>

      {/* group KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="集團現金（今日）"
          value={hkdCompact(groupBankTotal())}
          note="已對數 SuiteQL 銀行結餘（§10.4）"
        />
        <StatTile
          label="YTD 收入"
          value={hkdCompact(rev.actual)}
          delta={variancePct(rev.actual, rev.budget)}
          deltaLabel="vs 預算"
        />
        <StatTile
          label="YTD 毛利 GP"
          value={hkdCompact(gp.actual)}
          delta={variancePct(gp.actual, gp.ly)}
          deltaLabel="vs 去年"
        />
        <StatTile
          label="YTD 純利"
          value={hkdCompact(np.actual)}
          delta={variancePct(np.actual, np.budget)}
          deltaLabel="vs 預算"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="集團現金 — 30 日走勢" subtitle="各公司銀行結餘合計（HKD）">
          <BankTrendChart data={bank} />
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {OPERATING_SUBS.map((s) => {
              const bal = BANK_TODAY[s.id] ?? 0;
              const below = bal < s.cashFloor;
              return (
                <div key={s.id} className="rounded-lg border border-ringc px-2.5 py-2">
                  <div className="text-[11px] text-ink3 truncate">{s.short}</div>
                  <div className={`text-[15px] font-semibold num ${below ? "text-critical" : ""}`}>
                    {hkdCompact(bal)}
                  </div>
                  <div className={`text-[10px] ${below ? "text-critical" : "text-ink3"}`}>
                    {below ? "⚠ 低於警戒線" : `警戒線 ${hkdCompact(s.cashFloor)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="合併純利 — 逐月" subtitle="實際 vs 預算 vs 去年（HKD）">
          <MonthTrendChart data={npTrend} />
        </Card>
      </div>

      {/* per-company summary */}
      <Card title="各公司當年表現（YTD）" subtitle="收入／毛利／純利，對預算及去年">
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">收入</th>
                <th className="num">vs 預算</th>
                <th className="num">毛利</th>
                <th className="num">純利</th>
                <th className="num">純利 vs 去年</th>
              </tr>
            </thead>
            <tbody>
              {OPERATING_SUBS.map((s) => {
                const rows = pnlRows(s.id, YTD, false);
                const r = rows.find((x) => x.code === "TOTAL_REV")!;
                const g = rows.find((x) => x.code === "GP")!;
                const n = rows.find((x) => x.code === "NP")!;
                const revVar = variancePct(r.actual, r.budget);
                const npVar = variancePct(n.actual, n.ly);
                return (
                  <tr key={s.id}>
                    <td className="text-left">{s.short}</td>
                    <td className="num">{hkdCompact(r.actual)}</td>
                    <td className={`num ${revVar != null && revVar < 0 ? "text-critical" : "text-deltagood"}`}>
                      {revVar != null ? pct(revVar) : "—"}
                    </td>
                    <td className="num">{hkdCompact(g.actual)}</td>
                    <td className={`num ${n.actual < 0 ? "text-critical" : ""}`}>{hkdCompact(n.actual)}</td>
                    <td className={`num ${npVar != null && npVar < 0 ? "text-critical" : "text-deltagood"}`}>
                      {npVar != null ? pct(npVar) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Agency 指標（YTD）" subtitle="§6.2 — AGI 及效率指標">
          <div className="space-y-3">
            <KpiLine label="AGI" value={hkdCompact(kpi.agi)} />
            <KpiLine label="AGI margin" value={pct(kpi.agiMargin)} />
            <KpiLine
              label="Staff cost ÷ AGI"
              value={pct(kpi.staffToAgi)}
              flag={kpi.staffToAgi < 0.5 || kpi.staffToAgi > 0.6 ? "健康區間 50–60% 之外" : "健康區間 50–60% 內"}
              bad={kpi.staffToAgi > 0.6}
            />
            <KpiLine label="Revenue per head（年化）" value={hkdCompact(kpi.revenuePerHeadAnnualised)} />
            <KpiLine label="Top 5 客戶收入佔比" value={pct(conc.top5)} />
            <KpiLine label="Top 10 客戶收入佔比" value={pct(conc.top10)} />
          </div>
        </Card>

        <Card title="營運資金快照" subtitle="A/R aging 摘要 — 明細見 Cashflow 頁">
          <div className="space-y-3">
            <KpiLine label="應收總額" value={hkdCompact(arB.total)} />
            <KpiLine label="未到期" value={hkdCompact(arB.current)} />
            <KpiLine label="逾期 1–60 日" value={hkdCompact(arB.d1_30 + arB.d31_60)} />
            <KpiLine
              label="逾期 60 日以上"
              value={hkdCompact(arB.d61_90 + arB.d90p)}
              bad={arB.d61_90 + arB.d90p > 0}
            />
            <KpiLine label="DSO" value={`${dso(-1)} 日`} />
            <KpiLine
              label="YTD 收入（合併）"
              value={hkdCompact(
                sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [1, 2, 4, 5, 7, 8], months: YTD, groups: ["REV_SERVICE", "REV_TRAVEL", "REV_GOODS"] })
              )}
            />
          </div>
        </Card>

        <Card title="例外警示中心" subtitle="§7 規則（demo 數據觸發）">
          {alertList.map((a, i) => (
            <AlertRow key={i} severity={a.severity} title={a.title} detail={a.detail} />
          ))}
        </Card>
      </div>

      <p className="text-[11px] text-ink3">
        去年同期（{PRIOR_FY}）數字為全年入帳版本；合併 = 5 間公司 + Elimination 直接加總（全部 HKD base）。
      </p>
    </div>
  );
}

function KpiLine({ label, value, flag, bad }: { label: string; value: string; flag?: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-grid pb-2 last:border-b-0 last:pb-0">
      <span className="text-[12px] text-ink2">{label}</span>
      <span className="text-right">
        <span className={`text-[15px] font-semibold num ${bad ? "text-critical" : ""}`}>{value}</span>
        {flag && <span className={`block text-[10px] ${bad ? "text-critical" : "text-ink3"}`}>{flag}</span>}
      </span>
    </div>
  );
}
