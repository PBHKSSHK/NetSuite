"use client";

// 集團總覽 — landing page (blueprint §6.1 owner view + §6.2 agency KPIs + §6.5 alerts)

import Link from "next/link";
import { useState } from "react";
import { BankTrendChart, MonthTrendChart } from "@/components/charts";
import { Card, Seg, StatTile } from "@/components/ui";
import { BANK_TODAY, COLLECTIONS, DISBURSEMENTS } from "@/lib/store";
import { OPERATING_SUBS } from "@/lib/dims";
import { hkdCompact, pct, variancePct } from "@/lib/format";
import { ACTUAL_MONTHS, fyMonthLabel, monthsInPeriod, periodLabel, TODAY } from "@/lib/fy";
import {
  ageBuckets,
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
import { agiPerFeeEarner, ratioSuite, runwayBySub } from "../lib/agency";
import { chaseList, findings } from "@/lib/advisor";

/** 星期一開始嘅本週/上週範圍（ISO date strings） */
function weekRanges() {
  const d = new Date(TODAY);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const monThis = new Date(d.getTime() - dow * 86400000);
  const monLast = new Date(monThis.getTime() - 7 * 86400000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { thisStart: iso(monThis), lastStart: iso(monLast), lastEnd: iso(new Date(monThis.getTime() - 86400000)) };
}

export default function OverviewPage() {
  const [mode, setMode] = useState<"month" | "quarter" | "ytd">("ytd");
  const [month, setMonth] = useState(ACTUAL_MONTHS);
  const months = monthsInPeriod(mode, month);
  const plabel = periodLabel(mode, month);

  const bank = bankTrend().map((d) => ({ label: d.date.slice(5), total: d.total }));
  const npTrend = pnlTrend(-1, "NP").map((d) => ({ label: fyMonthLabel(d.month), ...d }));
  const kpi = kpiAgi(-1, months);
  const conc = concentration();
  const consolRows = pnlRows(-1, months, false);
  const rev = consolRows.find((r) => r.code === "TOTAL_REV")!;
  const gp = consolRows.find((r) => r.code === "GP")!;
  const np = consolRows.find((r) => r.code === "NP")!;
  const arB = ageBuckets(arItems(-1));
  const ratios = ratioSuite(months);
  const perFe = agiPerFeeEarner(months);

  // ── 行動區數據 ──
  const wk = weekRanges();
  const sumRange = (rows: { paymentDate: string; amount: number }[], from: string, to?: string) =>
    rows.filter((r) => r.paymentDate >= from && (!to || r.paymentDate <= to)).reduce((a, r) => a + r.amount, 0);
  const inThis = sumRange(COLLECTIONS, wk.thisStart);
  const outThis = sumRange(DISBURSEMENTS, wk.thisStart);
  const inLast = sumRange(COLLECTIONS, wk.lastStart, wk.lastEnd);
  const outLast = sumRange(DISBURSEMENTS, wk.lastStart, wk.lastEnd);
  const chase = chaseList().filter((r) => r.overdue30 > 0);
  const overdueTotal = chase.reduce((a, r) => a + r.overdue30, 0);
  const finds = findings();
  const urgent = finds.filter((f) => f.severity === "red");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">
          集團總覽 <span className="text-[13px] text-ink3 font-normal">FY2026/27 · {plabel}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Seg
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: "month" as const, label: "月" },
              { value: "quarter" as const, label: "季" },
              { value: "ytd" as const, label: "YTD" },
            ]}
          />
          {mode !== "ytd" && (
            <select
              className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px]"
              aria-label="選擇月份"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {fyMonthLabel(m)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── 今週行動 Action Zone ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-ringc bg-surface px-4 py-3">
          <div className="text-[11px] text-ink3 mb-1.5">本週收支（截至最新 sync）</div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <div>
              <span className="text-[11px] text-ink3">收款 </span>
              <span className="text-lg font-semibold num text-deltagood">{hkdCompact(inThis)}</span>
            </div>
            <div>
              <span className="text-[11px] text-ink3">出數 </span>
              <span className="text-lg font-semibold num">{hkdCompact(outThis)}</span>
            </div>
            <div>
              <span className="text-[11px] text-ink3">淨 </span>
              <span className={`text-lg font-semibold num ${inThis - outThis >= 0 ? "text-deltagood" : "text-critical"}`}>
                {inThis - outThis >= 0 ? "+" : "−"}
                {hkdCompact(Math.abs(inThis - outThis))}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-ink3 mt-1">
            上週：收 {hkdCompact(inLast)} · 出 {hkdCompact(outLast)} ·{" "}
            <Link href="/cashflow" className="text-accent hover:underline">
              收數週報 →
            </Link>
          </div>
        </div>

        <div className={`rounded-xl border bg-surface px-4 py-3 ${overdueTotal > 500_000 ? "border-critical/40" : "border-ringc"}`}>
          <div className="text-[11px] text-ink3 mb-1.5">被拖緊嘅錢（逾期 &gt;30 日）</div>
          <div className={`text-lg font-semibold num ${overdueTotal > 0 ? "text-critical" : ""}`}>{hkdCompact(overdueTotal)}</div>
          <div className="text-[11px] text-ink2 mt-1 truncate">
            {chase.slice(0, 3).map((r) => r.entityName.split("（")[0]).join("、")}
            {chase.length > 3 ? ` 等 ${chase.length} 個客` : ""}
          </div>
          <Link href="/advisor" className="text-[11px] text-accent hover:underline">
            追數清單（可一鍵複製）→
          </Link>
        </div>

        <div className={`rounded-xl border bg-surface px-4 py-3 ${urgent.length ? "border-critical/40" : "border-ringc"}`}>
          <div className="text-[11px] text-ink3 mb-1.5">要處理嘅事（CFO 助手）</div>
          {urgent.length === 0 ? (
            <div className="text-[13px] text-deltagood font-medium">✓ 暫無紅色警示</div>
          ) : (
            urgent.slice(0, 2).map((f, i) => (
              <div key={i} className="text-[12px] text-ink mb-0.5">
                <span className="text-critical font-semibold">●</span> {f.headline}
              </div>
            ))
          )}
          <Link href="/advisor" className="text-[11px] text-accent hover:underline">
            全部發現＋建議 →
          </Link>
        </div>
      </div>

      {/* group KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="集團現金（今日）"
          value={hkdCompact(groupBankTotal())}
          note="已對數 SuiteQL 銀行結餘（§10.4）"
        />
        <StatTile
          label={`${plabel} 收入`}
          value={hkdCompact(rev.actual)}
          delta={variancePct(rev.actual, rev.budget)}
          deltaLabel="vs 預算"
        />
        <StatTile
          label={`${plabel} 毛利 GP`}
          value={hkdCompact(gp.actual)}
          delta={variancePct(gp.actual, gp.ly)}
          deltaLabel="vs 去年"
        />
        <StatTile
          label={`${plabel} 純利`}
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
      <Card title={`各公司表現（${plabel}）`} subtitle="收入／毛利／純利，對預算及去年">
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
                const rows = pnlRows(s.id, months, false);
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
        <Card title={`Agency 指標（${plabel}）`} subtitle="§6.2 — AGI 及效率指標">
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
              label={`${plabel} 收入（合併）`}
              value={hkdCompact(
                sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [1, 2, 4, 5, 7, 8], months, groups: ["REV_SERVICE", "REV_TRAVEL", "REV_GOODS"] })
              )}
            />
          </div>
        </Card>

        <Card title="CFO 發現" subtitle="規則引擎（真數）— 完整建議喺 CFO 助手頁">
          <div className="space-y-2">
            {finds.slice(0, 5).map((f, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-grid pb-2 last:border-b-0 last:pb-0">
                <span
                  className={`mt-0.5 text-[10px] ${
                    f.severity === "red" ? "text-critical" : f.severity === "amber" ? "text-warn" : "text-accent"
                  }`}
                >
                  ●
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] text-ink font-medium">{f.headline}</div>
                  <div className="text-[11px] text-ink3 truncate">{f.action}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Agency 三大比率（§6.2 擴充；staff/AGI 已見上方 Agency 指標卡，不重複） */}
      <div className="space-y-2">
        <h2 className="text-[13px] font-semibold text-ink">
          Agency 三大比率{" "}
          <span className="text-[11px] text-ink3 font-normal">Agency ratio suite</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile
            label="Overheads ÷ AGI（不含員工成本）"
            value={`${ratios.overheadToAgiPct.toFixed(1)}%`}
            note={`健康區間 20–25%${
              ratios.overheadToAgiPct >= 20 && ratios.overheadToAgiPct <= 25 ? "（區間內）" : "（區間外）"
            }`}
          />
          <StatTile
            label="EBITDA ÷ AGI"
            value={`${ratios.ebitdaToAgiPct.toFixed(1)}%`}
            note={`健康區間 15–20%${
              ratios.ebitdaToAgiPct >= 15 && ratios.ebitdaToAgiPct <= 20 ? "（區間內）" : "（區間外）"
            }`}
          />
          <StatTile
            label="AGI per fee earner（年化）"
            value={hkdCompact(perFe.annualised)}
            note={`健康區間 HK$700K–1M／人 · fee earners ${perFe.feeEarners} 人`}
          />
        </div>
        <p className="text-[11px] text-ink3">比率駁通 NetSuite 即有；fee earner 人數需人手輸入</p>
      </div>

      {/* ── 現金 runway ─────────────────────────────────────────────────── */}
      <Card title="現金 Runway" subtitle="蝕緊錢嘅公司照而家 burn rate 仲頂到幾耐（近 3 個月平均現金淨流）">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {runwayBySub().map((r) => {
            const sub = OPERATING_SUBS.find((s) => s.id === r.subsidiaryId);
            const burning = r.runwayMonths != null;
            const critical = burning && (r.runwayMonths as number) < 9;
            return (
              <div key={r.subsidiaryId} className={`rounded-lg border px-3 py-2 ${critical ? "border-critical/50 bg-critical/5" : "border-ringc"}`}>
                <div className="text-[11px] text-ink3">{sub?.short}</div>
                <div className={`text-[17px] font-semibold num ${critical ? "text-critical" : burning ? "text-ink" : "text-deltagood"}`}>
                  {burning ? `${(r.runwayMonths as number).toFixed(0)} 個月` : "有盈餘"}
                </div>
                <div className="text-[11px] text-ink3 mt-0.5">
                  現金 {hkdCompact(r.cash)} · 每月{r.monthlyNet >= 0 ? "淨流入" : "燒"} {hkdCompact(Math.abs(r.monthlyNet))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ink3 mt-2">駁通 NetSuite 即有（銀行結餘 + 現金流）· 704 已貼近警戒線，runway 一併睇先完整</p>
      </Card>

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
