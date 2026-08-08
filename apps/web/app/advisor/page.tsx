"use client";

// CFO 助手 — 規則引擎 findings + 追數清單 + 流動性/借貸判斷（真數）。
// 第二層「AI CFO 週評」由 Claude API 生成（等 API key 接通後啟用）。

import { useState } from "react";
import { Card } from "@/components/ui";
import { chaseList, chaseReportText, findings, liquidity } from "@/lib/advisor";
import { subsidiaryById } from "@/lib/dims";
import { hkd, hkdCompact } from "@/lib/format";

const SEV_STYLE: Record<string, { badge: string; label: string }> = {
  red: { badge: "bg-critical/10 text-critical border-critical/40", label: "要處理" },
  amber: { badge: "bg-warn/15 text-ink2 border-warn/40", label: "留意" },
  info: { badge: "bg-accent/10 text-accent border-accent/30", label: "參考" },
};

export default function AdvisorPage() {
  const list = findings();
  const chase = chaseList().filter((r) => r.overdue30 > 0);
  const liq = liquidity();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">
        CFO 助手 <span className="text-[11px] text-ink3 font-normal">Advisor · 真數規則引擎，數字全部可追溯</span>
      </h1>

      {/* findings */}
      <div className="space-y-2">
        {list.map((f, i) => {
          const s = SEV_STYLE[f.severity];
          return (
            <div key={i} className={`rounded-xl border bg-surface px-4 py-3 ${f.severity === "red" ? "border-critical/40" : "border-ringc"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${s.badge}`}>{s.label}</span>
                <span className="text-[11px] text-ink3">{f.area}</span>
                <span className="text-[13px] font-semibold text-ink">{f.headline}</span>
              </div>
              <p className="text-[12px] text-ink2 mt-1">{f.detail}</p>
              <p className="text-[12px] mt-1">
                <span className="text-ink3">建議：</span>
                <span className="text-ink">{f.action}</span>
              </p>
            </div>
          );
        })}
      </div>

      {/* 追數清單 */}
      <Card
        title="追數清單 Chase List"
        subtitle="逾期 >30 日客戶，按嚴重程度排；撳客戶名展開逐張 invoice"
        right={
          <button
            onClick={() => {
              void navigator.clipboard.writeText(chaseReportText());
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="text-[12px] text-ink2 border border-ringc rounded-md px-2.5 py-1 hover:bg-ink3/10 shrink-0"
          >
            {copied ? "已複製 ✓" : "📋 複製追數清單"}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">客戶</th>
                <th className="num">未收總額</th>
                <th className="num">逾期 &gt;30 日</th>
                <th className="num">逾期 &gt;60 日</th>
                <th className="num">最耐（日）</th>
              </tr>
            </thead>
            <tbody>
              {chase.map((r) => (
                <>
                  <tr key={r.entityName} className="cursor-pointer" onClick={() => setOpen(open === r.entityName ? null : r.entityName)}>
                    <td className="text-left">
                      <span className="text-accent">{open === r.entityName ? "▾" : "▸"}</span> {r.entityName}
                    </td>
                    <td className="num">{hkd(r.totalOpen)}</td>
                    <td className={`num ${r.overdue30 > 0 ? "font-medium" : ""}`}>{hkd(r.overdue30)}</td>
                    <td className={`num ${r.overdue60 > 0 ? "text-critical font-semibold" : "text-ink3"}`}>
                      {r.overdue60 > 0 ? hkd(r.overdue60) : "—"}
                    </td>
                    <td className={`num ${r.oldestDays > 90 ? "text-critical" : ""}`}>{r.oldestDays}</td>
                  </tr>
                  {open === r.entityName &&
                    r.invoices.map((inv) => (
                      <tr key={inv.txnId} className="bg-ink3/5">
                        <td className="text-left pl-8 text-ink2 text-[12px]">
                          {inv.txnId} · {subsidiaryById(inv.subsidiaryId)?.short}
                        </td>
                        <td className="num text-[12px]">{hkd(inv.amount)}</td>
                        <td className="num text-[12px] text-ink3" colSpan={2}>
                          到期 {inv.dueDate}
                        </td>
                        <td className={`num text-[12px] ${inv.days > 90 ? "text-critical" : "text-ink2"}`}>{inv.days}</td>
                      </tr>
                    ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          來源：NetSuite A/R（每日 sync）。注意：收款批量遲入 NetSuite，個別「逾期」可能其實已收——會計當日入帳後自動修正。
        </p>
      </Card>

      {/* 流動性 */}
      <Card title="流動性一覽 Liquidity" subtitle="每間公司：現金 vs 警戒線、近月淨流、可動用資源">
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">現金</th>
                <th className="num">警戒線</th>
                <th className="num">近 3 個月平均淨流</th>
                <th className="num">Runway</th>
                <th className="num">未收 A/R</th>
                <th className="num">未付 A/P</th>
              </tr>
            </thead>
            <tbody>
              {liq.map((l) => {
                const name = subsidiaryById(l.subsidiaryId)?.short;
                return (
                  <tr key={l.subsidiaryId}>
                    <td className="text-left">{name}</td>
                    <td className={`num ${l.belowFloor ? "text-critical font-semibold" : ""}`}>{hkdCompact(l.cash)}</td>
                    <td className="num text-ink3">{hkdCompact(l.floor)}</td>
                    <td className={`num ${l.monthlyNet < 0 ? "text-critical" : "text-deltagood"}`}>
                      {l.monthlyNet < 0 ? "−" : "+"}
                      {hkdCompact(Math.abs(l.monthlyNet))}
                    </td>
                    <td className={`num ${l.runwayMonths != null && l.runwayMonths < 9 ? "text-critical font-medium" : ""}`}>
                      {l.runwayMonths != null ? `${l.runwayMonths} 個月` : "有盈餘"}
                    </td>
                    <td className="num">{hkdCompact(l.arOpen)}</td>
                    <td className="num">{hkdCompact(l.apOpen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">淨流以 P&L 淨額做 proxy（未扣 CapEx／貸款還本）；判斷借唔借貸請同時參考 findings 嘅集團層面分析。</p>
      </Card>

      {/* AI 週評 placeholder */}
      <Card title="AI CFO 週評" subtitle="第二層 — Claude 每週將上面嘅發現寫成一段完整 CFO 評語（優先次序 + 連貫判斷）">
        <p className="text-[13px] text-ink2">
          呢部分等一個 Anthropic API key 就可以啟用：每週一早上自動生成，內容只會引用規則引擎已核實嘅數字（唔會作數），
          並存底供翻查。設定方法：提供 API key 俾管理員放入 Supabase secrets。
        </p>
      </Card>
    </div>
  );
}
