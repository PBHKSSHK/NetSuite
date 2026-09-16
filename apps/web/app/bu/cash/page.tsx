"use client";

// BU Cashflow（Blueprint v0.1 §2.3 / §5.4）— A. BU cash contribution（payment link
// 連回 invoice / bill 行 department）；C. 公司層面 inter-co 結欠。

import { BuFilterBar } from "@/components/bu-filter-bar";
import { BuStackedChart } from "@/components/bu-charts";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import { BU_ORDER, CORE_BUS, FM_LABEL, buCash, buCashMonthly, buLabel, cashFys, icBalances, periodLabelOf, plByBu, type BuCode } from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { subName } from "@/lib/bu-ui";
import { hkd, hkdCompact } from "@/lib/format";

export default function BuCashPage() {
  const f = useBuFilters();
  const p = f.period;
  const cash = buCash(p);
  const pl = plByBu(p, 1);
  const monthly = buCashMonthly(f.fy).map((m) => ({ label: FM_LABEL[m.fm - 1], ...m.byBu }));
  const bal = icBalances();
  const asOf = bal[0]?.asOf ?? "";
  const bySub = new Map<number, typeof bal>();
  for (const b of bal) bySub.set(b.sub, [...(bySub.get(b.sub) ?? []), b]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">BU Cashflow</h1>
      <BuFilterBar />
      {!cash.hasData && (
        <p className="text-[12px] text-serious -mt-2">本期冇 payment link 數據（fact_bu_cash 覆蓋 {cashFys().join("、") || "—"}）。請揀 FY2025/26 或之後。</p>
      )}

      <Card
        title={`A. BU cash contribution — ${periodLabelOf(p)}`}
        subtitle="客戶收款 − 供應商付款（外部，按 invoice / bill 行 department 比例分攤落 BU）；集團內收付另列。人工、租金等由 PBHK 出，未計入。"
        right={<ExportButton onClick={() => exportCsv(`bu_cash_${p.fy}.csv`, ["BU", "外部收款", "外部付款", "Cash contribution", "IC 收", "IC 付", "純業務 EBITDA"], cash.rows.map((r) => [buLabel(r.bu), Math.round(r.extIn), Math.round(r.extOut), Math.round(r.net), Math.round(r.icIn), Math.round(r.icOut), Math.round(pl[r.bu].ebitda)]))} />}
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">BU</th>
                <th className="num">外部客戶收款</th>
                <th className="num">外部供應商付款</th>
                <th className="num">Cash contribution</th>
                <th className="num">集團內收</th>
                <th className="num">集團內付</th>
                <th className="num">純業務 EBITDA（對照）</th>
              </tr>
            </thead>
            <tbody>
              {cash.rows.map((r) => (
                <tr key={r.bu}>
                  <td className="text-left">{buLabel(r.bu)}</td>
                  <td className="num">{hkd(r.extIn)}</td>
                  <td className="num">{hkd(-r.extOut)}</td>
                  <td className={`num font-medium ${r.net < 0 ? "text-critical" : ""}`}>{hkd(r.net)}</td>
                  <td className="num text-ink2">{hkd(r.icIn)}</td>
                  <td className="num text-ink2">{hkd(-r.icOut)}</td>
                  <td className="num text-ink2">{hkd(pl[r.bu].ebitda)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">集團</td>
                <td className="num">{hkd(cash.total.extIn)}</td>
                <td className="num">{hkd(-cash.total.extOut)}</td>
                <td className="num">{hkd(cash.total.net)}</td>
                <td className="num">{hkd(cash.total.icIn)}</td>
                <td className="num">{hkd(-cash.total.icOut)}</td>
                <td className="num">{hkd(pl.TOTAL.ebitda)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">B. Indirect proxy（EBITDA − ΔA/R − ΔA/P）待 A/R / A/P by department snapshot（Phase 2）。集團內收 ≈ 集團內付 先算結算正常。</p>
      </Card>

      <Card title={`每月 cash contribution by BU — ${f.fy}`} subtitle="外部收款 − 外部付款，堆疊">
        {monthly.length ? <BuStackedChart data={monthly} bus={[...CORE_BUS, "OTHER" as BuCode]} /> : <p className="text-[12px] text-ink3">本財年冇 cash 數據。</p>}
      </Card>

      <Card title="C. Inter-co 結欠（Amount Due From / To）" subtitle={`每間公司帳面 IC 應收（+）/ 應付（−），fact_gl 累計至 ${asOf || "—"}（每日 sync）`}>
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="text-left">帳戶</th>
                <th className="num">結欠</th>
              </tr>
            </thead>
            <tbody>
              {[...bySub.entries()].map(([sub, rows]) => (
                <>
                  {rows.map((b, i) => (
                    <tr key={`${sub}|${b.acct}`}>
                      <td className="text-left">{i === 0 ? subName(sub) : ""}</td>
                      <td className="text-left text-ink2">
                        {b.acctnumber} {b.name.split(" : ").pop()}
                      </td>
                      <td className={`num ${b.net < 0 ? "text-critical" : ""}`}>{hkd(b.net)}</td>
                    </tr>
                  ))}
                  <tr key={`${sub}|sub`} className="subtotal">
                    <td className="text-left">{subName(sub)} 淨額</td>
                    <td></td>
                    <td className="num">{hkd(rows.reduce((a, b) => a + b.net, 0))}</td>
                  </tr>
                </>
              ))}
              {!bal.length && (
                <tr>
                  <td colSpan={3} className="text-ink3 text-left">
                    fact_gl 未有 IC 結欠帳戶數據
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">Inter-co 結算建議（邊間公司幾時 settle 畀邊間）：以上結欠 + 各公司 bank balance / 13 週 forecast（/cashflow）一併睇。集團合計理論上 = 0（含 Go Asia / Jervois T / X 等非 NetSuite 對手方則不為 0）。</p>
      </Card>
      <div className="text-[11px] text-ink3">{BU_ORDER.length ? "" : ""}</div>
    </div>
  );
}
