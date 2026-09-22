"use client";

// BU P&L（Blueprint v0.1 §5.2）— 管理帳格式，每 BU 一欄；法定（per company）
// 切換；Layer 1 / Layer 2 + 分攤方法；月度 trend；drill-down BU → 公司/dept → account。

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BuFilterBar } from "@/components/bu-filter-bar";
import { BuLinesChart } from "@/components/bu-charts";
import { Card, ExportButton, Seg, exportCsv } from "@/components/ui";
import {
  BU_ORDER,
  CORE_BUS,
  FM_LABEL,
  MGMT_LINE_LABEL,
  buLabel,
  buMonthly,
  drill,
  lastMonthWithData,
  periodLabelOf,
  plByBu,
  plBySub,
  type BuCode,
  type Metric,
  type MgmtLine,
  type PlColumn,
} from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { subName } from "@/lib/bu-ui";
import { hkd, pct } from "@/lib/format";

type RowDef = { key: string; label: string; kind: "line" | "subtotal"; get: (c: PlColumn) => number; line?: MgmtLine };

function rowsFor(view: "mgmt" | "legal", layer: 1 | 2): RowDef[] {
  const line = (l: MgmtLine): RowDef => ({ key: l, label: MGMT_LINE_LABEL[l], kind: "line", get: (c) => c.lines[l], line: l });
  const rows: RowDef[] = [
    line("REVENUE"),
    line("DIRECT_COST"),
    { key: "GP", label: "毛利 Gross Profit", kind: "subtotal", get: (c) => c.gp },
    line("STAFF"),
    line("RENT"),
    line("MARKETING"),
    line("ADMIN"),
  ];
  if (view === "legal") rows.push(line("IC_MGMT_FEE"));
  if (view === "mgmt" && layer === 2) {
    rows.push({ key: "ALLOC", label: "PB 平台成本分攤（Admin / IT / Mgt）", kind: "line", get: (c) => c.allocation });
    rows.push({ key: "DIRECTOR", label: "老闆人工（BU 報表口徑）", kind: "line", get: (c) => c.directorAlloc });
  }
  rows.push({ key: "EBITDA", label: "EBITDA", kind: "subtotal", get: (c) => (view === "mgmt" && layer === 2 ? c.ebitdaAlloc : c.ebitda) });
  rows.push(line("DEPRECIATION"), line("OTHER_INCOME"), line("FINANCE"), line("OTHER_EXPENSE"), line("TAX"));
  rows.push({ key: "NP", label: "純利 Net Profit", kind: "subtotal", get: (c) => (view === "mgmt" && layer === 2 ? c.npAlloc : c.np) });
  return rows;
}

function PnlInner() {
  const f = useBuFilters();
  const sp = useSearchParams();
  const [view, setView] = useState<"mgmt" | "legal">("mgmt");
  const [metric, setMetric] = useState<Metric>("EBITDA");
  const [drillBu, setDrillBu] = useState<BuCode>((sp.get("bu") as BuCode) || "EPR");
  const [openDept, setOpenDept] = useState<string | null>(null);
  const p = f.period;

  const mgmt = plByBu(p, f.layer, f.allocKey, f.netAssocFee);
  const legal = plBySub(p);
  const rows = rowsFor(view, f.layer);
  const columns: { key: string; label: string; col: PlColumn }[] =
    view === "mgmt"
      ? [...BU_ORDER.map((b) => ({ key: b, label: buLabel(b), col: mgmt[b] })), { key: "TOTAL", label: "集團管理帳", col: mgmt.TOTAL }]
      : [...legal.subs.map((s) => ({ key: String(s), label: subName(s), col: legal.cols[s] })), { key: "TOTAL", label: "法定合計（未抵銷）", col: legal.total }];

  const last = lastMonthWithData(f.fy);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const row: { label: string; TOTAL?: number | null } & Partial<Record<BuCode, number | null>> = { label: FM_LABEL[m - 1] };
    if (m <= last) {
      for (const b of CORE_BUS) row[b] = buMonthly(f.fy, b, metric, f.layer, f.allocKey)[m - 1];
      row.TOTAL = buMonthly(f.fy, "TOTAL", metric, f.layer, f.allocKey)[m - 1];
    }
    return row;
  });

  const depts = drill(p, drillBu);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">BU P&L</h1>
        <Seg
          options={[
            { value: "mgmt", label: "管理帳（per BU）" },
            { value: "legal", label: "法定（per company）" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      <BuFilterBar showLayer={view === "mgmt"} showAlloc={view === "mgmt"} />

      <Card
        title={view === "mgmt" ? `管理帳 P&L by BU — ${periodLabelOf(p)}` : `法定 P&L by company — ${periodLabelOf(p)}`}
        subtitle={
          view === "mgmt"
            ? `已剔除所有集團內交易（management fee / 分攤 journal、借名開單 invoice / bill、年結 DN）；${f.layer === 2 ? `PB 平台成本按「${f.allocKey}」分攤 + 老闆人工按 worksheet 分落 BU` : "未分攤 PB 平台成本及老闆人工"} · HKD`
            : "NetSuite 原帳（含集團內交易）；「法定合計」未做 elimination · HKD"
        }
        right={<ExportButton onClick={() => exportCsv(`bu_pnl_${view}_${p.fy}.csv`, ["行項", ...columns.map((c) => c.label)], rows.map((r) => [r.label, ...columns.map((c) => Math.round(r.get(c.col)))]))} />}
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">行項</th>
                {columns.map((c) => (
                  <th key={c.key} className={`num ${c.key === "TOTAL" ? "text-ink" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.kind === "subtotal" ? "subtotal" : ""}>
                  <td className={`text-left ${r.kind === "line" ? "pl-4 text-ink2" : ""}`}>{r.label}</td>
                  {columns.map((c) => {
                    const v = r.get(c.col);
                    return (
                      <td key={c.key} className={`num ${Math.abs(v) < 1 ? "text-ink3" : r.kind === "subtotal" && v < 0 ? "text-critical" : ""}`}>
                        {Math.abs(v) < 1 ? "—" : hkd(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="text-left pl-4 text-ink3">GP%</td>
                {columns.map((c) => (
                  <td key={c.key} className="num text-ink3">
                    {c.col.revenue ? pct(c.col.gp / c.col.revenue) : "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          {view === "mgmt"
            ? "收入落在 department 所屬 BU，唔理由哪間公司開單（§2.2 步驟 3）。SHARED 欄 = PBHK Admin / Management / IT 外部成本；Layer 2 後由 4 個 BU 承擔。"
            : "法定合計 vs 管理帳合計嘅差異 = 集團內交易淨額（見 Bridge 頁）。"}
        </p>
      </Card>

      <Card
        title={`月度 trend — ${f.fy}`}
        subtitle={`4 個 BU ${f.layer === 2 ? "分攤後" : "純業務"}；虛線 = 集團管理帳合計`}
        right={
          <Seg
            options={[
              { value: "REV", label: "收入" },
              { value: "GP", label: "毛利" },
              { value: "EBITDA", label: "EBITDA" },
              { value: "NP", label: "純利" },
            ]}
            value={metric}
            onChange={setMetric}
          />
        }
      >
        <BuLinesChart data={trend} bus={CORE_BUS} showTotal />
      </Card>

      <Card
        title="Drill-down：BU → 公司 / department → account"
        subtitle="純業務行（EXTERNAL）；點擊 department 展開 account"
        right={
          <Seg options={BU_ORDER.map((b) => ({ value: b, label: buLabel(b) }))} value={drillBu} onChange={(b) => { setDrillBu(b); setOpenDept(null); }} />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">公司 · department</th>
                <th className="num">收入</th>
                <th className="num">直接成本</th>
                <th className="num">Opex</th>
                <th className="num">其他</th>
                <th className="num">純利</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => {
                const k = `${d.sub}|${d.dept}`;
                const open = openDept === k;
                return (
                  <>
                    <tr key={k} className="cursor-pointer hover:bg-ink3/5" onClick={() => setOpenDept(open ? null : k)}>
                      <td className="text-left">
                        <span className="text-accent mr-1">{open ? "▾" : "▸"}</span>
                        {subName(d.sub)} · {d.deptName}
                      </td>
                      <td className="num">{hkd(d.revenue)}</td>
                      <td className="num">{hkd(d.directCost)}</td>
                      <td className="num">{hkd(d.opex)}</td>
                      <td className="num">{hkd(d.other)}</td>
                      <td className={`num font-medium ${d.np < 0 ? "text-critical" : ""}`}>{hkd(d.np)}</td>
                    </tr>
                    {open &&
                      d.accounts.map((a) => (
                        <tr key={`${k}|${a.acct}`} className="bg-ink3/5">
                          <td className="text-left pl-8 text-ink2">
                            {a.acctnumber} {a.name.split(" : ").pop()} <span className="text-ink3">· {MGMT_LINE_LABEL[a.mgmtLine].split(" ")[0]} · {a.lines} 行</span>
                          </td>
                          <td className="num" colSpan={4}></td>
                          <td className="num">{hkd(a.amount)}</td>
                        </tr>
                      ))}
                  </>
                );
              })}
              {!depts.length && (
                <tr>
                  <td colSpan={6} className="text-ink3 text-left">
                    本期冇數據
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">Transaction 層 drill（連 NetSuite record link）屬 Phase 3 後續：fact_bu_pl 而家按月 × account 合計，未存 transaction id。</p>
      </Card>
    </div>
  );
}

export default function BuPnlPage() {
  return (
    <Suspense fallback={null}>
      <PnlInner />
    </Suspense>
  );
}
