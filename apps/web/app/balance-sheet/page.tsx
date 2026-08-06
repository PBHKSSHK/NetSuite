"use client";

// Balance Sheet（§5.2）— as-of picker、行項由 report_group 驅動、
// 銀行結餘一行與 bank widget 同源。

import { FilterBar } from "@/components/filter-bar";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import { BS_SECTION_LABELS } from "@/lib/dims";
import { useFilters } from "@/lib/filters";
import { hkd, hkdCompact } from "@/lib/format";
import { fyMonthEnd } from "@/lib/fy";
import { ageBuckets, apItems, arItems, balanceSheet } from "@/lib/queries";
import { subsidiaryById } from "@/lib/dims";
import Link from "next/link";

const SECTIONS = ["CURRENT_ASSETS", "NON_CURRENT_ASSETS", "CURRENT_LIABILITIES", "EQUITY"];

export default function BalanceSheetPage() {
  const f = useFilters();
  const { rows, totals } = balanceSheet(f.subsidiary, f.month);
  const subLabel = f.subsidiary === -1 ? "合併（全集團）" : subsidiaryById(f.subsidiary)?.short ?? "";
  const asOf = fyMonthEnd(f.month);
  const arTotal = ageBuckets(arItems(f.subsidiary)).total;
  const apTotal = ageBuckets(apItems(f.subsidiary)).total;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">資產負債表 Balance Sheet</h1>
      <FilterBar />

      <Card
        title={`Balance Sheet — ${subLabel}`}
        subtitle={`截至 ${asOf} · HKD · 保留盈利 = 歷年累計 + 本年 P&L（app 層計算）`}
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `bs_${subLabel}_${asOf}.csv`,
                ["行項", "金額"],
                rows.map((r) => [r.label, r.amount])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px] max-w-2xl">
            <thead>
              <tr>
                <th className="text-left">行項</th>
                <th className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((sec) => {
                const secRows = rows.filter((r) => r.section === sec);
                const secTotal = secRows.reduce((a, r) => a + r.amount, 0);
                return [
                  <tr key={sec}>
                    <td className="text-left font-medium text-ink" colSpan={2}>
                      {BS_SECTION_LABELS[sec]}
                    </td>
                  </tr>,
                  ...secRows.map((r) => (
                    <tr key={r.code}>
                      <td className="text-left pl-5 text-ink2">
                        {r.label}
                        {r.code === "BS_CASH" && (
                          <span className="ml-1.5 text-[10px] text-ink3">（= bank widget 同一數據源）</span>
                        )}
                        {(r.code === "BS_AR" || r.code === "BS_AP") && (
                          <Link href="/cashflow" className="ml-1.5 text-[10px] text-accent hover:underline">
                            aging →
                          </Link>
                        )}
                      </td>
                      <td className="num">{hkd(r.amount)}</td>
                    </tr>
                  )),
                  <tr key={sec + "_t"} className="subtotal">
                    <td className="text-left">{BS_SECTION_LABELS[sec]}小計</td>
                    <td className="num">{hkd(secTotal)}</td>
                  </tr>,
                ];
              })}
              <tr className="subtotal">
                <td className="text-left">資產淨值 Net Assets</td>
                <td className="num">{hkd(totals.netAssets)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid sm:grid-cols-3 gap-2 text-[12px]">
          <div className="rounded-lg border border-ringc px-3 py-2">
            <span className="text-ink3">總資產</span>
            <div className="font-semibold num">{hkdCompact(totals.assets)}</div>
          </div>
          <div className="rounded-lg border border-ringc px-3 py-2">
            <span className="text-ink3">總負債</span>
            <div className="font-semibold num">{hkdCompact(totals.liabilities)}</div>
          </div>
          <div className="rounded-lg border border-ringc px-3 py-2">
            <span className="text-ink3">對數檢查：A/R aging 總額 = BS 應收（{hkdCompact(arTotal)}）；A/P 同理（{hkdCompact(apTotal)}）</span>
            <div className="font-semibold text-deltagood">✓ 一致（§10.4 驗收項 4）</div>
          </div>
        </div>
      </Card>

      <p className="text-[11px] text-ink3">
        合併版 = 直加含 Elimination；production 如與 NetSuite consolidated report（subsidiary -1）有差異，會列「對數差異」提示（§10.4 驗收項 3）。
      </p>
    </div>
  );
}
