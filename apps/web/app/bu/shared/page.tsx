"use client";

// Cost Center / Shared Services（Blueprint v0.1 §5.6）— PBHK Admin / Management / IT
// 成本池明細、月度 trend、per head、分攤方法對比、Go Asia / JS admin fee 對照。

import { BuFilterBar } from "@/components/bu-filter-bar";
import { AllocCompareChart, BuLinesChart } from "@/components/bu-charts";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import { CORE_BUS, FM_LABEL, MGMT_LINE_LABEL, allocationFor, associatesAdminFee, buLabel, lastMonthWithData, mgmtFeeCheck, periodLabelOf, sharedPool, type AllocKey, type BuCode, type MgmtLine } from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { ALLOC_RULES, HEADCOUNT } from "@/lib/bu-store";
import { subName } from "@/lib/bu-ui";
import { hkd, hkdCompact } from "@/lib/format";

export default function SharedPage() {
  const f = useBuFilters();
  const p = f.period;
  const pool = sharedPool(p, f.netAssocFee);
  const keys = ALLOC_RULES.map((r) => r.keyType as AllocKey);
  const allocs = keys.map((k) => allocationFor(p, k, f.netAssocFee));
  const chosen = allocationFor(p, f.allocKey, f.netAssocFee);
  const mf = mgmtFeeCheck(p);
  const last = lastMonthWithData(f.fy);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const row: { label: string } & Partial<Record<BuCode, number | null>> = { label: FM_LABEL[m - 1] };
    if (m <= last) {
      const sp = sharedPool({ fy: f.fy, months: [m] }, false);
      row.SHARED = Math.round(sp.gross);
      row.OTHER = Math.round(associatesAdminFee({ fy: f.fy, months: [m] }));
    }
    return row;
  });
  const compare = CORE_BUS.map((b) => {
    const row: { label: string; [k: string]: number | string } = { label: buLabel(b) };
    allocs.forEach((a) => (row[a.key] = a.amount[b]));
    return row;
  });
  const headcountTotal = CORE_BUS.reduce((a, b) => a + chosen.basis[b], 0);
  const hcYm = allocationFor(p, "headcount", f.netAssocFee);
  const perHead = headcountTotal && f.allocKey === "headcount" ? pool.net / headcountTotal : null;
  const lineKeys = (Object.keys(pool.byLine) as MgmtLine[]).filter((k) => Math.abs(pool.byLine[k]) >= 1);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Shared cost 分攤 · PB 平台</h1>
      <BuFilterBar showAlloc />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">Gross pool（PBHK Admin+Mgt+IT 外部淨成本）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(pool.gross)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">− Go Asia / JS 外部 admin fee</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(pool.assocFee)}</div>
          <div className="text-[11px] text-ink3 mt-1">= PB mgmt fee income − 4 間子公司 mgmt fee 費用{f.netAssocFee ? "" : "（未扣減）"}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">分攤 pool（淨）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(pool.net)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">Per head（人頭法）</div>
          <div className="text-2xl font-semibold mt-1 num">{perHead != null ? hkdCompact(perHead) : hkcPerHead(pool.net, hcYm)}</div>
          <div className="text-[11px] text-ink3 mt-1">headcount {hcYm.headcountYm ?? "未有紀錄"}：{CORE_BUS.reduce((a, b) => a + hcYm.basis[b], 0)} 人</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Pool 明細 — by department" subtitle={`${periodLabelOf(p)} · 純業務（EXTERNAL）行；正數 = 淨成本`}>
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">PBHK department</th>
                <th className="num">淨成本</th>
                <th className="num">佔比</th>
              </tr>
            </thead>
            <tbody>
              {pool.byDept.map((d) => (
                <tr key={d.dept}>
                  <td className="text-left">{d.name}</td>
                  <td className="num">{hkd(d.amount)}</td>
                  <td className="num text-ink3">{pool.gross ? ((100 * d.amount) / pool.gross).toFixed(1) + "%" : "—"}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">Gross pool</td>
                <td className="num">{hkd(pool.gross)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Pool 明細 — by 行次" subtitle="人工 / 租金 / 行政…（收入正、成本負）">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">行次</th>
                <th className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {lineKeys.map((k) => (
                <tr key={k}>
                  <td className="text-left">{MGMT_LINE_LABEL[k]}</td>
                  <td className="num">{hkd(pool.byLine[k])}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">淨額（= −Gross pool）</td>
                <td className="num">{hkd(-pool.gross)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Pool 月度 trend — ${f.fy}`} subtitle="Gross pool（PB 平台淨成本）vs 向 Go Asia / JS 收的 admin fee（按 mgmt fee journal 入帳月）">
        <BuLinesChart data={trend} bus={["SHARED", "OTHER"]} />
        <p className="text-[11px] text-ink3 mt-1">圖例：「PB 平台」= gross pool；「其他」= associates admin fee。年結一次過入嘅 mgmt fee 會令個別月份跳升。</p>
      </Card>

      <Card
        title="分攤方法對比"
        subtitle={`同一 pool（${hkdCompact(pool.net)}）用唔同 key 分俾 4 個 BU`}
        right={<ExportButton onClick={() => exportCsv(`allocation_compare_${p.fy}.csv`, ["BU", ...allocs.map((a) => a.label)], CORE_BUS.map((b) => [buLabel(b), ...allocs.map((a) => a.amount[b])]))} />}
      >
        <AllocCompareChart data={compare} series={allocs.map((a) => ({ key: a.key, label: a.label }))} />
        <div className="overflow-x-auto mt-2">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">BU</th>
                {allocs.map((a) => (
                  <th key={a.key} className="num">
                    {a.label}
                    {a.key === f.allocKey ? " ★" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CORE_BUS.map((b) => (
                <tr key={b}>
                  <td className="text-left">{buLabel(b)}</td>
                  {allocs.map((a) => (
                    <td key={a.key} className="num">
                      {hkd(a.amount[b])} <span className="text-ink3">({(a.share[b] * 100).toFixed(1)}%)</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="text-left text-ink3">基準</td>
                {allocs.map((a) => (
                  <td key={a.key} className="num text-ink3 text-[11px]">
                    {a.basisLabel}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">Rules 存 <code>allocation_rules</code>；headcount 存 <code>headcount_monthly</code>（每月人手輸入或 AlphaHRMS；未輸入嘅月份沿用最近一次）。</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Headcount 紀錄" subtitle="headcount_monthly（最新 12 條）">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">月份</th>
                <th className="text-left">BU</th>
                <th className="num">人數</th>
                <th className="text-left">來源</th>
              </tr>
            </thead>
            <tbody>
              {[...HEADCOUNT]
                .sort((a, b) => (a.ym === b.ym ? a.buCode.localeCompare(b.buCode) : b.ym.localeCompare(a.ym)))
                .slice(0, 12)
                .map((h) => (
                  <tr key={`${h.ym}|${h.buCode}`}>
                    <td className="text-left">{h.ym}</td>
                    <td className="text-left">{buLabel(h.buCode)}</td>
                    <td className="num">{h.headcount}</td>
                    <td className="text-left text-ink3 text-[11px]">{h.source}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
        <Card title="Management fee 對照（法定帳）" subtitle="PB 60000022 收入 vs 各公司 81000059 / 81000068 費用；差額 = 向 Go Asia / JS 收取">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">Mgmt fee 費用</th>
              </tr>
            </thead>
            <tbody>
              {mf.bySub.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className="num">{hkd(r.expense)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">子公司合計</td>
                <td className="num">{hkd(mf.subTotal)}</td>
              </tr>
              <tr>
                <td className="text-left">PB Management Fee Income</td>
                <td className="num">{hkd(mf.pbIncome)}</td>
              </tr>
              <tr className="subtotal">
                <td className="text-left">差額（associates：Go Asia / JS）</td>
                <td className={`num ${mf.assoc < 0 ? "text-critical" : ""}`}>{hkd(mf.assoc)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-ink3 mt-2">Recharge 合約狀態（704 40% production 人工、JS headcount）待會計提供後補入（§5.6）。</p>
        </Card>
      </div>
    </div>
  );
}

function hkcPerHead(pool: number, hc: ReturnType<typeof allocationFor>): string {
  const n = CORE_BUS.reduce((a, b) => a + hc.basis[b], 0);
  return n ? hkdCompact(pool / n) : "—";
}
