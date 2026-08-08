"use client";

// Cost Center（§5.5）— Department P&L 矩陣 + Untagged bucket + tagging
// hygiene 指標 + Photoblog 分攤 engine（pro-forma）。

import { useState } from "react";
import { TaggingTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import { DEPARTMENTS, OPERATING_SUBS, subsidiaryById } from "@/lib/dims";
import { useFilters } from "@/lib/filters";
import { hkd, hkdCompact, pct } from "@/lib/format";
import { fyMonthLabel, periodLabel } from "@/lib/fy";
import { allocationForPeriod, costCenterMatrix, taggingTrend } from "@/lib/queries";
import { pbRecoveryRate } from "../../lib/agency";

export default function CostCenterPage() {
  const f = useFilters();
  const activeSub = f.subsidiary === -1 || f.subsidiary === 4 ? 1 : f.subsidiary;
  const matrix = costCenterMatrix(activeSub, f.months);
  const subLabel = subsidiaryById(activeSub)?.short ?? "";
  const trend = taggingTrend();
  const latest = trend[trend.length - 1];
  const alloc = allocationForPeriod(f.months, "actual");
  const [deptId, setDeptId] = useState(6);

  const untaggedPctOfCost =
    matrix.untaggedTotal + matrix.taggedTotal > 0
      ? matrix.untaggedTotal / (matrix.untaggedTotal + matrix.taggedTotal)
      : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">成本中心 Cost Center</h1>
      <FilterBar />
      {(f.subsidiary === -1 || f.subsidiary === 4) && (
        <p className="text-[12px] text-ink3 -mt-2">
          Cost Center 以單一公司檢視（Department 維度）；已預設顯示 Photoblog，可用上方選單切換公司。
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">本期未標示（Untagged）成本</div>
          <div className="text-2xl font-semibold mt-1">{hkdCompact(matrix.untaggedTotal)}</div>
          <div className="text-[11px] text-ink3 mt-1">佔成本 {pct(untaggedPctOfCost)} — 數據可信度前提（§5.5）</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">本月未標示 department 行數</div>
          <div className="text-2xl font-semibold mt-1">{latest.untaggedLines}</div>
          <div className="text-[11px] text-ink3 mt-1">佔 vendor bill lines {latest.untaggedPct}%（audit 基線 46%）</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">分攤 pool（dept 6/9/11，本期）</div>
          <div className="text-2xl font-semibold mt-1">{hkdCompact(alloc.pool)}</div>
          <div className="text-[11px] text-ink3 mt-1">按四公司 GP 比例分攤（pro-forma）</div>
        </div>
      </div>

      <Card
        title={`Department 成本矩陣 — ${subLabel}`}
        subtitle={`${periodLabel(f.mode, f.month)} · 實際 · HKD ·「未標示」bucket 必須顯示（audit：vendor bill lines 僅 54% 有 department）`}
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `costcenter_${subLabel}.csv`,
                ["行項", ...matrix.columns.map((c) => c.label), "合計"],
                matrix.rows.map((r) => [r.label, ...r.cells, r.total])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">行項</th>
                {matrix.columns.map((c) => (
                  <th key={c.deptId} className={`num ${c.deptId === 0 ? "text-serious" : ""}`}>
                    {c.label}
                  </th>
                ))}
                <th className="num">合計</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.code}>
                  <td className="text-left text-ink2">{r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="num">
                      {c ? hkd(c) : <span className="text-ink3">—</span>}
                    </td>
                  ))}
                  <td className="num font-medium">{hkd(r.total)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                {matrix.columns.map((c, i) => (
                  <td key={c.deptId} className="num">
                    {hkd(matrix.rows.reduce((a, r) => a + r.cells[i], 0))}
                  </td>
                ))}
                <td className="num">{hkd(matrix.rows.reduce((a, r) => a + r.total, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Tagging hygiene — 未標示比例 trend" subtitle="俾會計追數；建議 NetSuite form 將 department 設必填（§9.4）">
          <TaggingTrendChart data={trend} />
        </Card>

        <Card title="單一 Department 跨公司" subtitle="同一部門喺各公司嘅本期成本">
          <select
            value={deptId}
            onChange={(e) => setDeptId(Number(e.target.value))}
            className="bg-surface border border-ringc rounded-lg px-2.5 py-1.5 text-[13px] mb-3"
            aria-label="選擇部門"
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameZh}（{d.name}）
              </option>
            ))}
          </select>
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">本期成本</th>
              </tr>
            </thead>
            <tbody>
              {OPERATING_SUBS.map((s) => {
                const m = costCenterMatrix(s.id, f.months);
                const col = m.columns.findIndex((c) => c.deptId === deptId);
                const amt = col >= 0 ? m.rows.reduce((a, r) => a + r.cells[col], 0) : 0;
                return (
                  <tr key={s.id}>
                    <td className="text-left">{s.short}</td>
                    <td className="num">{amt ? hkd(amt) : <span className="text-ink3">冇此部門</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title="Photoblog 分攤明細（pro-forma）"
        subtitle="dept 6/9/11 本期成本按四公司 GP 比例分攤 — 純管理報表，不改 NetSuite 條數；可 export 方便將來真正入帳（§5.5）"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `allocation_${periodLabel(f.mode, f.month)}.csv`,
                ["公司", "GP 佔比", "獲分攤金額"],
                alloc.gpShares.map((g) => [subsidiaryById(g.sub)?.short ?? "", (g.share * 100).toFixed(1) + "%", Math.round(alloc.bySub[g.sub] ?? 0)])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px] max-w-xl">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">GP 佔比</th>
                <th className="num">獲分攤金額</th>
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
                <td className="text-left">Photoblog 分攤出</td>
                <td className="num">—</td>
                <td className="num">({hkd(Math.abs(alloc.bySub[1] ?? 0))})</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          Rules 存 <code>alloc_rules</code>（method = GP_RATIO），production 由會計喺 admin UI 調整。
        </p>
      </Card>

      {/* ── PB 中央成本回收率 ────────────────────────────────────────────── */}
      <Card
        title="PB 中央成本回收率 Central Cost Recovery"
        subtitle="Photoblog Admin/IT/Mgt pool vs 收返嘅 management fee + reimbursement — <100% 即係 PB 補貼緊集團"
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px] max-w-2xl">
            <thead>
              <tr>
                <th className="text-left">月份</th>
                <th className="num">中央成本 pool</th>
                <th className="num">已回收</th>
                <th className="num">回收率</th>
                <th className="num">PB 補貼</th>
              </tr>
            </thead>
            <tbody>
              {pbRecoveryRate().map((r) => (
                <tr key={r.month}>
                  <td className="text-left">{fyMonthLabel(r.month)}</td>
                  <td className="num">{hkd(r.pool)}</td>
                  <td className="num text-ink2">{hkd(r.recovered)}</td>
                  <td className={`num font-medium ${r.ratePct < 90 ? "text-critical" : "text-ink2"}`}>{r.ratePct}%</td>
                  <td className="num text-critical">{hkd(r.pool - r.recovered)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">YTD</td>
                <td className="num">{hkd(pbRecoveryRate().reduce((a, r) => a + r.pool, 0))}</td>
                <td className="num">{hkd(pbRecoveryRate().reduce((a, r) => a + r.recovered, 0))}</td>
                <td className="num">
                  {(
                    (100 * pbRecoveryRate().reduce((a, r) => a + r.recovered, 0)) /
                    pbRecoveryRate().reduce((a, r) => a + r.pool, 0)
                  ).toFixed(1)}
                  %
                </td>
                <td className="num text-critical">{hkd(pbRecoveryRate().reduce((a, r) => a + (r.pool - r.recovered), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          駁通 NetSuite 即有（pool = PB 三個 dept 成本；回收 = 60000022 Management Fee Income + Share of Expenses journals）。真帳參考：Mar 2025 pool ~480K、收返 ~452K（見 docs/allocation-rules.md）。決策問題：條 gap 係咪應該收埋 associates／提高 GP% 分攤？
        </p>
      </Card>
    </div>
  );
}
