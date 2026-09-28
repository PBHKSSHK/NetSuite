"use client";

// Bridge（Blueprint v0.1 §2.2 步驟 5 / §5.2）— 法定 5 間公司 net profit →
// 剔除 IC → BU 純業務 → 分攤 → BU 管理帳。總和必須對得上。

import { BuFilterBar } from "@/components/bu-filter-bar";
import { WaterfallChart } from "@/components/bu-charts";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import { BU_ORDER, CORE_BUS, bridge, buLabel, periodLabelOf } from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { subName } from "@/lib/bu-ui";
import { hkd, hkdCompact } from "@/lib/format";

export default function BridgePage() {
  const f = useBuFilters();
  const p = f.period;
  const b = bridge(p, f.allocKey, f.netAssocFee);
  const t = b.totals;
  const icTotal = t.icMgmtFee + t.icInvoice + t.icBill + t.icJournal;
  const l2Total = BU_ORDER.reduce((a, x) => a + b.layer2[x], 0);

  const steps = [
    { label: "法定 NP 合計", value: t.legalNp, total: true },
    { label: "− IC mgmt fee", value: -t.icMgmtFee },
    { label: "− IC invoice", value: -t.icInvoice },
    { label: "− IC bill", value: -t.icBill },
    { label: "− IC journal", value: -t.icJournal },
    { label: "BU 純業務 NP", value: t.externalNp, total: true },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Bridge：法定 → 管理帳</h1>
      <BuFilterBar showAlloc />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">法定 net profit 合計（未抵銷）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(t.legalNp)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">剔除集團內交易淨額</div>
          <div className={`text-2xl font-semibold mt-1 num ${Math.abs(icTotal) > 50_000 ? "text-serious" : ""}`}>{hkdCompact(-icTotal)}</div>
          <div className="text-[11px] text-ink3 mt-1">理想 ≈ 0；差額 = 借名開單時間差 / associates admin fee</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">BU 純業務 NP 合計（Layer 1）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(t.externalNp)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">對數檢查</div>
          <div className={`text-2xl font-semibold mt-1 num ${b.check === 0 ? "text-deltagood" : "text-critical"}`}>{b.check === 0 ? "✓ 0" : hkd(b.check)}</div>
          <div className="text-[11px] text-ink3 mt-1">Σ 公司外部 NP − Σ BU Layer 1 NP</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="集團瀑布圖" subtitle={`${periodLabelOf(p)} · 法定合計 → 剔 IC → 純業務`}>
          <WaterfallChart steps={steps} />
        </Card>
        <Card title="IC 抵銷淨額拆解" subtitle="每類集團內交易：全集團加總（收入正、成本負）">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">類別</th>
                <th className="num">集團淨額</th>
                <th className="text-left">解讀</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-left">Management fee（60000022 vs 81000059/68）</td>
                <td className="num">{hkd(t.icMgmtFee)}</td>
                <td className="text-left text-ink3 text-[11px]">正數 = PB 向 Go Asia / JS（非 NetSuite subsidiary）收的部分</td>
              </tr>
              <tr>
                <td className="text-left">借名開單 invoice（集團 customer）</td>
                <td className="num">{hkd(t.icInvoice)}</td>
                <td className="text-left text-ink3 text-[11px]">應同下行 IC bill 抵銷</td>
              </tr>
              <tr>
                <td className="text-left">Recharge vendor bill（集團 vendor）</td>
                <td className="num">{hkd(t.icBill)}</td>
                <td className="text-left text-ink3 text-[11px]">invoice + bill ≠ 0 = 時間差或單邊入帳</td>
              </tr>
              <tr>
                <td className="text-left">IC journal（租金 / 器材 / 年結 recharge）</td>
                <td className="num">{hkd(t.icJournal)}</td>
                <td className="text-left text-ink3 text-[11px]">同一 journal 有 Amount Due From/To 對手方</td>
              </tr>
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">{hkd(icTotal)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title="每間公司：法定 → 外部（純業務）"
        subtitle="逐項列出剔除嘅 IC 金額（收入正、成本負），再按 department → BU 歸集"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `bridge_${p.fy}.csv`,
                ["公司", "法定 NP", "IC mgmt fee", "IC invoice", "IC bill", "IC journal", "外部 NP", ...BU_ORDER.map(buLabel)],
                b.subRows.map((r) => [subName(r.sub), Math.round(r.legalNp), Math.round(r.icMgmtFee), Math.round(r.icInvoice), Math.round(r.icBill), Math.round(r.icJournal), Math.round(r.externalNp), ...BU_ORDER.map((x) => Math.round(r.byBu[x]))])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">法定 NP</th>
                <th className="num">− IC mgmt fee</th>
                <th className="num">− IC invoice</th>
                <th className="num">− IC bill</th>
                <th className="num">− IC journal</th>
                <th className="num">= 外部 NP</th>
                {BU_ORDER.map((x) => (
                  <th key={x} className="num">
                    {buLabel(x)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.subRows.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className="num">{hkd(r.legalNp)}</td>
                  <td className="num text-ink2">{hkd(-r.icMgmtFee)}</td>
                  <td className="num text-ink2">{hkd(-r.icInvoice)}</td>
                  <td className="num text-ink2">{hkd(-r.icBill)}</td>
                  <td className="num text-ink2">{hkd(-r.icJournal)}</td>
                  <td className="num font-medium">{hkd(r.externalNp)}</td>
                  {BU_ORDER.map((x) => (
                    <td key={x} className={`num ${Math.abs(r.byBu[x]) < 1 ? "text-ink3" : ""}`}>
                      {Math.abs(r.byBu[x]) < 1 ? "—" : hkd(r.byBu[x])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">{hkd(t.legalNp)}</td>
                <td className="num">{hkd(-t.icMgmtFee)}</td>
                <td className="num">{hkd(-t.icInvoice)}</td>
                <td className="num">{hkd(-t.icBill)}</td>
                <td className="num">{hkd(-t.icJournal)}</td>
                <td className="num">{hkd(t.externalNp)}</td>
                {BU_ORDER.map((x) => (
                  <td key={x} className="num">
                    {hkd(b.layer1[x])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="每個 BU：純業務（Layer 1）→ 分攤（Layer 2）" subtitle={`分攤 key：${b.alloc.label} · pool ${hkdCompact(b.alloc.pool)}（gross ${hkdCompact(b.alloc.grossPool)} − Go Asia/JS 人頭份額 ${hkdCompact(b.alloc.assocFee)}）· 老闆人工 ${hkdCompact(b.alloc.director.sheetTotal)}（帳面 ${hkdCompact(b.alloc.director.ledgerTotal)}）`}>
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px] max-w-3xl">
            <thead>
              <tr>
                <th className="text-left">BU</th>
                <th className="num">Layer 1 純業務 NP</th>
                <th className="num">分攤（平台成本 + 老闆人工；承擔 −／釋出 +）</th>
                <th className="num">Layer 2 管理帳 NP</th>
                <th className="num">分攤比例</th>
              </tr>
            </thead>
            <tbody>
              {BU_ORDER.map((x) => (
                <tr key={x}>
                  <td className="text-left">{buLabel(x)}</td>
                  <td className="num">{hkd(b.layer1[x])}</td>
                  <td className="num text-ink2">{hkd(b.layer2[x] - b.layer1[x])}</td>
                  <td className={`num font-medium ${b.layer2[x] < 0 ? "text-critical" : ""}`}>{hkd(b.layer2[x])}</td>
                  <td className="num text-ink3">{CORE_BUS.includes(x) ? `${(b.alloc.share[x] * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">集團管理帳</td>
                <td className="num">{hkd(t.externalNp)}</td>
                <td className="num">{hkd(l2Total - t.externalNp)}</td>
                <td className="num">{hkd(l2Total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">分攤總和 = 0（pool + 老闆人工由 SHARED 釋出，4 個 BU 承擔）；集團管理帳 NP 不因分攤而改變。SHARED 分攤後剩餘 = Go Asia / JS 人頭份額（應向 associates 收回）+ 老闆人工 worksheet 口徑 vs 帳面差異。</p>
      </Card>
    </div>
  );
}
