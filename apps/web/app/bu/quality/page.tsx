"use client";

// Data Quality & mapping（Blueprint v0.1 §5.8）— 未標 department、IC 分類彙總、
// mgmt fee 對稱、借名開單配對、pass-through 線、bu_mapping 覆蓋、IC entity 對照。

import { BuFilterBar } from "@/components/bu-filter-bar";
import { Card } from "@/components/ui";
import { IC_FLAG_LABEL, availableFys, buLabel, icFlagSummary, icPairs, ledgerCoverage, ledgerFys, mappingCoverage, mgmtFeeCheck, passThroughLines, periodLabelOf, taxSavingCheck, taxSavingRows, untaggedByFy, untaggedBySub } from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { BU_MAPPING, IC_ENTITIES } from "@/lib/bu-store";
import { subName } from "@/lib/bu-ui";
import { hkd, hkdCompact, pct } from "@/lib/format";

export default function QualityPage() {
  const f = useBuFilters();
  const p = f.period;
  const untag = untaggedBySub(p);
  const byFy = untaggedByFy();
  const subs = [...new Set(byFy.flatMap((r) => Object.keys(r.bySub).map(Number)))].sort((a, b) => a - b);
  const flags = icFlagSummary(p);
  const pairs = icPairs(p);
  const pt = passThroughLines(p);
  const cov = mappingCoverage(p);
  const mf = mgmtFeeCheck(p);
  const ents = [...IC_ENTITIES.values()].sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId);
  const taxRows = taxSavingRows(f.fy);
  const taxCheck = taxSavingCheck(f.fy);
  const lcov = ledgerCoverage(p);
  const lfys = ledgerFys();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Data quality & 對照表</h1>
      <BuFilterBar />

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`未標 department 的 P&L 行 — ${periodLabelOf(p)}`} subtitle="目標 0；未標行落入「其他」BU，還原口徑會偏差">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">未標金額（絕對值）</th>
                <th className="num">行數</th>
                <th className="num">佔 P&L 流量</th>
              </tr>
            </thead>
            <tbody>
              {untag.map((u) => (
                <tr key={u.sub}>
                  <td className="text-left">{subName(u.sub)}</td>
                  <td className="num">{hkd(u.amount)}</td>
                  <td className="num">{u.lines}</td>
                  <td className={`num ${u.pct > 0.05 ? "text-critical" : u.pct > 0.01 ? "text-serious" : "text-deltagood"}`}>{pct(u.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Department 標記覆蓋率 by 財年" subtitle="未標比例（按金額）；§1.5：FY22/23 及之前 PBHK 只能到公司層面">
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[12px]">
              <thead>
                <tr>
                  <th className="text-left">財年</th>
                  {subs.map((s) => (
                    <th key={s} className="num">
                      {subName(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byFy.map((r) => (
                  <tr key={r.fy}>
                    <td className="text-left">{r.fy}</td>
                    {subs.map((s) => {
                      const v = r.bySub[s];
                      return (
                        <td key={s} className={`num ${v == null ? "text-ink3" : v > 0.05 ? "text-critical" : v > 0.01 ? "text-serious" : "text-deltagood"}`}>
                          {v == null ? "—" : pct(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink3 mt-2">可用財年：{availableFys().join("、")}</p>
        </Card>
      </div>

      <Card title="集團內交易分類彙總" subtitle="每條 P&L 行的 ic_flag（§2.2 步驟 2）；EXTERNAL 以外全部喺管理帳剔除">
        <table className="report-table w-full text-[13px] max-w-3xl">
          <thead>
            <tr>
              <th className="text-left">ic_flag</th>
              <th className="num">收入側</th>
              <th className="num">成本側</th>
              <th className="num">淨額</th>
              <th className="num">行數</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((r) => (
              <tr key={r.flag}>
                <td className="text-left">{IC_FLAG_LABEL[r.flag]}</td>
                <td className="num">{hkd(r.income)}</td>
                <td className="num">{hkd(-r.cost)}</td>
                <td className={`num ${r.flag !== "EXTERNAL" && Math.abs(r.income - r.cost) > 50_000 ? "text-serious" : ""}`}>{hkd(r.income - r.cost)}</td>
                <td className="num">{r.lines}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="借名開單配對（invoice ↔ bill）" subtitle="A 向 B 開的 IC invoice vs B 入 A 的 IC bill；差額 = 時間差 / 未入單 / 對照表漏 entity">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">開單 → 對手</th>
                <th className="num">IC invoice</th>
                <th className="num">IC bill</th>
                <th className="num">差額</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((x) => (
                <tr key={`${x.from}|${x.to}`}>
                  <td className="text-left">
                    {subName(x.from)} → {subName(x.to)}
                  </td>
                  <td className="num">{hkd(x.invoiced)}</td>
                  <td className="num">{hkd(x.billed)}</td>
                  <td className={`num ${Math.abs(x.diff) > 50_000 ? "text-critical" : Math.abs(x.diff) > 1 ? "text-serious" : "text-deltagood"}`}>{hkd(x.diff)}</td>
                </tr>
              ))}
              {!pairs.length && (
                <tr>
                  <td colSpan={4} className="text-ink3 text-left">
                    本期冇 IC invoice / bill
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Management fee 對稱檢查" subtitle="PB 60000022 vs 子公司 81000059 / 81000068">
          <table className="report-table w-full text-[13px]">
            <tbody>
              <tr>
                <td className="text-left">PB Management Fee Income</td>
                <td className="num">{hkd(mf.pbIncome)}</td>
              </tr>
              {mf.bySub.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left pl-4 text-ink2">{subName(r.sub)} 費用</td>
                  <td className="num">{hkd(r.expense)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">差額（應 = Go Asia / JS 收費 ≥ 0）</td>
                <td className={`num ${mf.assoc < 0 ? "text-critical" : ""}`}>{hkd(mf.assoc)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`年結 tax planning 開單（會計 worksheet）vs 本系統剔除 — ${f.fy}`} subtitle="worksheet：每行正數 = 開單（收入）方、負數 = 被扣方；本系統：全年剔除嘅 IC invoice / bill / 分攤 journal 淨額（收入正、成本負）。差額 = 未識別嘅集團 entity 或非年結 IC 交易（借名開單、recharge）。">
        <div className="grid lg:grid-cols-2 gap-4">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">性質</th>
                <th className="text-left">公司</th>
                <th className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {taxRows.map((r, i) => (
                <tr key={i}>
                  <td className="text-left">{r.nature}</td>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className={`num ${r.amount < 0 ? "text-critical" : ""}`}>{hkd(r.amount)}</td>
                </tr>
              ))}
              {!taxRows.length && (
                <tr>
                  <td colSpan={3} className="text-ink3 text-left">
                    worksheet 冇此財年紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">worksheet 淨額</th>
                <th className="num">本系統剔除淨額</th>
                <th className="num">差額</th>
              </tr>
            </thead>
            <tbody>
              {taxCheck.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className="num">{hkd(r.sheet)}</td>
                  <td className="num">{hkd(r.eliminated)}</td>
                  <td className="num text-ink2">{hkd(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`會計 GP% 分攤清單覆蓋 — ${periodLabelOf(p)}`}
        subtitle={`「BU gross profit share」workbook（覆蓋 FY ${lfys[0] ?? "—"} → ${lfys[lfys.length - 1] ?? "—"}）每個（公司 × 月 × account）淨額 vs 本系統 IC 剔除行（ic_flag ≠ EXTERNAL）。差額 ≠ 0 = 有分攤交易未被識別為 IC（entity 對照漏、journal 規則漏網）或同一 account 內另有 IC 交易；「本系統另剔除」= workbook 未列但本系統剔除嘅 IC 交易（借名開單 / recharge）。`}
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">workbook 淨額（debit − credit）</th>
                <th className="num">本系統 IC 剔除淨額</th>
                <th className="num">差額</th>
                <th className="num">有差異格數</th>
                <th className="num">本系統另剔除（workbook 未列）</th>
                <th className="text-left">最大差異（月 · account · workbook / 本系統）</th>
              </tr>
            </thead>
            <tbody>
              {lcov.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className="num">{hkd(r.ledger)}</td>
                  <td className="num">{hkd(r.facts)}</td>
                  <td className={`num ${Math.abs(r.diff) > 1 ? "text-serious" : "text-ok"}`}>{hkd(r.diff)}</td>
                  <td className="num">{r.cells}</td>
                  <td className="num text-ink2">{hkd(r.factsOnly)}</td>
                  <td className="text-left text-[11px] text-ink2">
                    {r.worst.map((w) => `${w.ym} · ${w.acct} · ${hkdCompact(w.ledger)} / ${hkdCompact(w.facts)}`).join("；") || "—"}
                  </td>
                </tr>
              ))}
              {!lcov.length && (
                <tr>
                  <td colSpan={7} className="text-ink3 text-left">
                    本期 workbook 冇分攤交易（清單覆蓋 2020-04 → 2026-03）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Pass-through 線（收入 ≈ 直接成本 ±15%）" subtitle="借名開單特徵（§1.3 觀察）；IC 比例 = 該線流量中集團內交易佔比">
        <table className="report-table w-full text-[13px] max-w-3xl">
          <thead>
            <tr>
              <th className="text-left">公司 · department</th>
              <th className="num">收入</th>
              <th className="num">直接成本</th>
              <th className="num">IC 比例</th>
            </tr>
          </thead>
          <tbody>
            {pt.map((r) => (
              <tr key={`${r.sub}|${r.dept}`}>
                <td className="text-left">
                  {subName(r.sub)} · {r.deptName}
                </td>
                <td className="num">{hkd(r.revenue)}</td>
                <td className="num">{hkd(r.directCost)}</td>
                <td className="num">{pct(r.icShare)}</td>
              </tr>
            ))}
            {!pt.length && (
              <tr>
                <td colSpan={4} className="text-ink3 text-left">
                  本期冇 pass-through 特徵線
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="bu_mapping 覆蓋" subtitle="本期有交易的公司 × department → BU；「預設」= 靠公司 fallback，建議明確列入">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="report-table w-full text-[12px]">
              <thead>
                <tr>
                  <th className="text-left">公司</th>
                  <th className="text-left">department</th>
                  <th className="text-left">BU</th>
                  <th className="num">流量</th>
                  <th className="text-left">來源</th>
                </tr>
              </thead>
              <tbody>
                {cov.map((r) => (
                  <tr key={`${r.sub}|${r.dept}`}>
                    <td className="text-left">{subName(r.sub)}</td>
                    <td className="text-left">{r.deptName}</td>
                    <td className="text-left">{buLabel(r.bu)}</td>
                    <td className="num">{hkdCompact(r.amountAbs)}</td>
                    <td className={`text-left text-[11px] ${r.explicit ? "text-ink3" : "text-serious"}`}>{r.explicit ? "明確" : "預設"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink3 mt-2">共 {BU_MAPPING.length} 條 mapping（Supabase bu_mapping，可加 effective_from / to 重跑歷史）。</p>
        </Card>
        <Card title="IC entity 對照表" subtitle="ic_entity_map（§3.2 初始值）；related_external = 保留為外部客戶">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="report-table w-full text-[12px]">
              <thead>
                <tr>
                  <th className="text-left">id</th>
                  <th className="text-left">類型</th>
                  <th className="text-left">名稱</th>
                  <th className="text-left">對手方</th>
                  <th className="text-left">關係</th>
                </tr>
              </thead>
              <tbody>
                {ents.map((e) => (
                  <tr key={e.entityId}>
                    <td className="text-left">{e.entityId}</td>
                    <td className="text-left">{e.entityType}</td>
                    <td className="text-left">{e.name}</td>
                    <td className="text-left">{e.counterpartySubsidiaryId != null ? subName(e.counterpartySubsidiaryId) : "—"}</td>
                    <td className={`text-left ${e.relation === "group" ? "" : "text-serious"}`}>{e.relation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
