"use client";

// BU Cockpit（Blueprint v0.1 §5.1）— 老闆首頁：集團 KPI、4 個 BU 卡片、
// 5 間公司今日 bank balance、警示。數字 = 純業務（Layer 1）/ 分攤後（Layer 2）。

import Link from "next/link";
import { BuFilterBar } from "@/components/bu-filter-bar";
import { BuStackedChart } from "@/components/bu-charts";
import { AlertRow, Card, StatTile } from "@/components/ui";
import { CORE_BUS, FM_LABEL, buCash, buLabel, buMonthly, icPairs, lastMonthWithData, mgmtFeeCheck, periodLabelOf, plByBu, untaggedBySub, type BuCode } from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { BU_META } from "@/lib/bu-store";
import { delta, light, lyPeriod, subName } from "@/lib/bu-ui";
import { OPERATING_SUBS } from "@/lib/dims";
import { hkd, hkdCompact, pct, signedPct } from "@/lib/format";
import { ageBuckets, arItems } from "@/lib/queries";
import { BANK_TODAY, DATA_AS_OF } from "@/lib/store";

const LIGHT_CLASS: Record<string, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-critical", na: "bg-ink3/40" };

export default function BuCockpit() {
  const f = useBuFilters();
  if (!BU_META.rows) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">BU Cockpit</h1>
        <p className="text-[13px] text-ink2">fact_bu_pl 未有數據——請先跑 NetSuite → Supabase 還原 ETL（見 packages/sync/bu-restoration.md）。</p>
      </div>
    );
  }
  const p = f.period;
  const cur = plByBu(p, f.layer, f.allocKey, f.netAssocFee);
  const lyP = lyPeriod(p);
  const ly = lyP ? plByBu(lyP, f.layer, f.allocKey, f.netAssocFee) : null;
  const cash = buCash(p);
  const T = cur.TOTAL;
  const TL = ly?.TOTAL;
  const npOf = (c: typeof T) => (f.layer === 2 ? c.npAlloc : c.np);
  const ebitdaOf = (c: typeof T) => (f.layer === 2 ? c.ebitdaAlloc : c.ebitda);

  const last = lastMonthWithData(f.fy);
  const monthly = Array.from({ length: last }, (_, i) => {
    const m = i + 1;
    const row: { label: string } & Partial<Record<BuCode, number | null>> = { label: FM_LABEL[m - 1] };
    for (const b of CORE_BUS) row[b] = buMonthly(f.fy, b, "EBITDA", f.layer, f.allocKey)[m - 1];
    return row;
  });

  const groupBank = OPERATING_SUBS.reduce((a, s) => a + (BANK_TODAY[s.id] ?? 0), 0);

  // 警示
  const alerts: { severity: string; title: string; detail: string }[] = [];
  const ar90 = ageBuckets(arItems(-1)).d90p;
  if (ar90 > 0) alerts.push({ severity: ar90 > 1_000_000 ? "critical" : "serious", title: `A/R 逾期 >90 天 ${hkdCompact(ar90)}`, detail: "集團外部客戶（截至最後 sync）；詳見 /cashflow A/R aging" });
  const pairs = icPairs(p).filter((x) => Math.abs(x.diff) > 50_000);
  for (const x of pairs.slice(0, 3)) alerts.push({ severity: "serious", title: `IC 配對差異 ${subName(x.from)} → ${subName(x.to)}：${hkdCompact(x.diff)}`, detail: `${subName(x.from)} 開 IC invoice ${hkdCompact(x.invoiced)} vs ${subName(x.to)} 入 IC bill ${hkdCompact(x.billed)}（本期，時間差或漏入單）` });
  const untag = untaggedBySub(p).filter((u) => u.pct > 0.02);
  for (const u of untag) alerts.push({ severity: u.pct > 0.1 ? "serious" : "warning", title: `${subName(u.sub)} 未標 department ${pct(u.pct)}`, detail: `${hkdCompact(u.amount)}（${u.lines} 行）落入「其他」BU；目標 0` });
  const mf = mgmtFeeCheck(p);
  if (mf.assoc < 0) alerts.push({ severity: "serious", title: "Management fee 單邊：子公司費用 > PB 收入", detail: `PB 60000022 ${hkdCompact(mf.pbIncome)} vs 子公司 81000059 合計 ${hkdCompact(mf.subTotal)}` });
  if (!alerts.length) alerts.push({ severity: "good", title: "本期冇異常", detail: "IC 配對、department 標記、management fee 對稱檢查全部通過" });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">
          BU Cockpit <span className="text-[13px] text-ink3 font-normal">{periodLabelOf(p)} · 管理帳（剔除集團內交易）</span>
        </h1>
      </div>
      <BuFilterBar showLayer showAlloc />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="集團外部收入" value={hkdCompact(T.revenue)} delta={delta(T.revenue, TL?.revenue)} deltaLabel="vs 去年同期" />
        <StatTile label={`毛利 GP（${pct(T.revenue ? T.gp / T.revenue : 0)}）`} value={hkdCompact(T.gp)} delta={delta(T.gp, TL?.gp)} deltaLabel="vs 去年同期" />
        <StatTile label={f.layer === 2 ? "EBITDA（分攤後）" : "EBITDA（純業務）"} value={hkdCompact(ebitdaOf(T))} delta={delta(ebitdaOf(T), TL ? ebitdaOf(TL) : null)} deltaLabel="vs 去年同期" />
        <StatTile label="純利 Net（管理帳）" value={hkdCompact(npOf(T))} delta={delta(npOf(T), TL ? npOf(TL) : null)} deltaLabel="vs 去年同期" note={`法定合計對數見 Bridge；分攤 key：${f.allocKey}`} />
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        {CORE_BUS.map((b) => {
          const c = cur[b];
          const l = ly?.[b];
          const d = delta(npOf(c), l ? npOf(l) : null);
          const cashRow = cash.rows.find((r) => r.bu === b)!;
          return (
            <Link key={b} href={`/bu/pnl?bu=${b}`} className="block bg-surface rounded-xl border border-ringc shadow-sm px-4 py-3.5 hover:border-accent/60">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold">{buLabel(b)}</div>
                <span className={`h-2.5 w-2.5 rounded-full ${LIGHT_CLASS[light(d)]}`} title="vs 去年同期 ±10%" aria-label={`狀態 ${light(d)}`} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                <div className="text-ink3">收入</div>
                <div className="num font-medium">{hkdCompact(c.revenue)}</div>
                <div className="text-ink3">GP%</div>
                <div className="num">{c.revenue ? pct(c.gp / c.revenue) : "—"}</div>
                <div className="text-ink3">{f.layer === 2 ? "分攤後純利" : "純業務純利"}</div>
                <div className={`num font-medium ${npOf(c) < 0 ? "text-critical" : ""}`}>{hkdCompact(npOf(c))}</div>
                <div className="text-ink3">vs 去年</div>
                <div className={`num ${d == null ? "text-ink3" : d >= 0 ? "text-deltagood" : "text-critical"}`}>{d == null ? "—" : signedPct(d)}</div>
                <div className="text-ink3">Cash contribution</div>
                <div className={`num ${cash.hasData ? (cashRow.net < 0 ? "text-critical" : "") : "text-ink3"}`}>{cash.hasData ? hkdCompact(cashRow.net) : "未有 cash 數據"}</div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title={`每月 EBITDA by BU — ${f.fy}`} subtitle={f.layer === 2 ? `分攤後（${f.allocKey}）` : "純業務（未分攤 PB 平台成本）"} className="lg:col-span-2">
          <BuStackedChart data={monthly} bus={CORE_BUS} />
        </Card>
        <Card title="今日 bank balance" subtitle={`集團合計 ${hkdCompact(groupBank)} · ${DATA_AS_OF.value}`}>
          <table className="report-table w-full text-[13px]">
            <tbody>
              {OPERATING_SUBS.map((s) => (
                <tr key={s.id}>
                  <td className="text-left">{s.short}</td>
                  <td className={`num ${(BANK_TODAY[s.id] ?? 0) < s.cashFloor ? "text-critical" : ""}`}>{hkd(BANK_TODAY[s.id] ?? 0)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">集團</td>
                <td className="num">{hkd(groupBank)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-ink3 mt-2">紅色 = 低於該公司現金警戒線。13 週 runway 見 /cashflow。</p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="警示" subtitle="IC 配對、department 標記、management fee 對稱、A/R >90 天">
          {alerts.map((a, i) => (
            <AlertRow key={i} severity={a.severity} title={a.title} detail={a.detail} />
          ))}
        </Card>
        <Card title="PB 平台 / 其他" subtitle="未分攤 pool 及非核心線（Pro Health、JS、Travel、未標 dept）">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">線</th>
                <th className="num">收入</th>
                <th className="num">純業務純利</th>
                <th className="num">分攤後</th>
              </tr>
            </thead>
            <tbody>
              {(["SHARED", "OTHER"] as BuCode[]).map((b) => (
                <tr key={b}>
                  <td className="text-left">{buLabel(b)}</td>
                  <td className="num">{hkd(cur[b].revenue)}</td>
                  <td className="num">{hkd(cur[b].np)}</td>
                  <td className="num">{hkd(cur[b].npAlloc)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">4 BU + 平台 + 其他 = 集團管理帳</td>
                <td className="num">{hkd(T.revenue)}</td>
                <td className="num">{hkd(T.np)}</td>
                <td className="num">{hkd(T.npAlloc)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-ink3 mt-2">SHARED 分攤後應接近 0（剩餘 = 向 Go Asia / JS 收的 admin fee 或未扣減部分）。</p>
        </Card>
      </div>
    </div>
  );
}
