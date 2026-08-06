"use client";

// Cashflow（§5.4）— 三個 tab：月度實際現金流、Weekly Customer Revenue &
// Cash Flow、13-week rolling forecast；另附 A/R・A/P aging（§6.3）。

import { useState } from "react";
import { AgingChart, ForecastChart, WeeklyCashChart } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { Card, ExportButton, Seg, exportCsv } from "@/components/ui";
import { weeklyCashSeries, weeklyClientReport } from "@/lib/demo";
import { useFilters } from "@/lib/filters";
import { hkd, hkdCompact } from "@/lib/format";
import { fyMonthFull } from "@/lib/fy";
import {
  ageBuckets,
  apItems,
  arItems,
  cashflowMonthly,
  dpo,
  dso,
  forecast13w,
} from "@/lib/queries";
import { subsidiaryById } from "@/lib/dims";

type Tab = "monthly" | "weekly" | "forecast" | "aging";

export default function CashflowPage() {
  const f = useFilters();
  const [tab, setTab] = useState<Tab>("monthly");
  const [lag, setLag] = useState(14);
  const subLabel = f.subsidiary === -1 ? "合併（全集團）" : subsidiaryById(f.subsidiary)?.short ?? "";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">現金流 Cashflow</h1>
      <FilterBar />
      <Seg
        options={[
          { value: "monthly", label: "月度實際" },
          { value: "weekly", label: "每週報表" },
          { value: "forecast", label: "13 週預測" },
          { value: "aging", label: "A/R・A/P Aging" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "monthly" && <MonthlyTab subLabel={subLabel} subsidiary={f.subsidiary} />}
      {tab === "weekly" && <WeeklyTab />}
      {tab === "forecast" && <ForecastTab lag={lag} setLag={setLag} />}
      {tab === "aging" && <AgingTab subsidiary={f.subsidiary} />}
    </div>
  );
}

function MonthlyTab({ subLabel, subsidiary }: { subLabel: string; subsidiary: number }) {
  const rows = cashflowMonthly(subsidiary);
  return (
    <Card
      title={`實際現金流（月度）— ${subLabel}`}
      subtitle="由 bank accounts GL 流水歸類（demo 為近似值）· 期末結餘與 bank widget 同源"
      right={
        <ExportButton
          onClick={() =>
            exportCsv(
              `cashflow_monthly_${subLabel}.csv`,
              ["月份", "收客款", "付供應商", "糧金及MPF", "租金及固定支出", "其他", "淨現金流", "期初", "期末"],
              rows.map((r) => [fyMonthFull(r.month), r.receipts, -r.suppliers, -r.payroll, -r.rentAndRecurring, -r.other, r.net, r.opening, r.closing])
            )
          }
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="report-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">月份</th>
              <th className="num">收客款</th>
              <th className="num">付供應商</th>
              <th className="num">糧金及 MPF</th>
              <th className="num">租金/固定</th>
              <th className="num">其他</th>
              <th className="num">淨現金流</th>
              <th className="num">期末結餘</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="text-left">{fyMonthFull(r.month)}</td>
                <td className="num">{hkd(r.receipts)}</td>
                <td className="num text-ink2">({hkd(r.suppliers)})</td>
                <td className="num text-ink2">({hkd(r.payroll)})</td>
                <td className="num text-ink2">({hkd(r.rentAndRecurring)})</td>
                <td className="num text-ink2">({hkd(r.other)})</td>
                <td className={`num font-medium ${r.net < 0 ? "text-critical" : "text-deltagood"}`}>{hkd(r.net)}</td>
                <td className="num font-medium">{hkd(r.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink3 mt-2">
        Production 版按交易類型歸類（CustPymt / VendPym / BillPay / payroll / 稅 / intercompany）。稅項月份（11 月、1 月）demo 未含。
      </p>
    </Card>
  );
}

function WeeklyTab() {
  const report = weeklyClientReport();
  const series = weeklyCashSeries().map((w) => ({ label: w.week, cashIn: w.cashIn, cashOut: w.cashOut }));
  const totals = report.rows.reduce(
    (a, r) => ({ billed: a.billed + r.billed, collected: a.collected + r.collected, ar: a.ar + r.endingAr }),
    { billed: 0, collected: 0, ar: 0 }
  );
  return (
    <div className="space-y-4">
      <Card title="本週現金收支（近 8 週）" subtitle="每週一自動生成並存檔（配合 7 年保留政策）">
        <WeeklyCashChart data={series} />
      </Card>
      <Card
        title={`Weekly Customer Revenue & Cash Flow — 週始 ${report.weekOf}`}
        subtitle="取代現有人手報表：本週各客戶開票、收款、期末應收"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `weekly_${report.weekOf}.csv`,
                ["客戶", "本週開票", "本週收款", "期末應收"],
                report.rows.map((r) => [r.client, r.billed, r.collected, r.endingAr])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">客戶</th>
                <th className="num">本週開票</th>
                <th className="num">本週收款</th>
                <th className="num">期末應收</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.client}>
                  <td className="text-left">{r.client}</td>
                  <td className="num">{hkd(r.billed)}</td>
                  <td className="num">{hkd(r.collected)}</td>
                  <td className="num">{hkd(r.endingAr)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">{hkd(totals.billed)}</td>
                <td className="num">{hkd(totals.collected)}</td>
                <td className="num">{hkd(totals.ar)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ForecastTab({ lag, setLag }: { lag: number; setLag: (n: number) => void }) {
  const { weeks, floor } = forecast13w(lag);
  const chartData = weeks.map((w) => ({ label: w.weekStart.slice(5), closing: w.closing }));
  const firstBreach = weeks.find((w) => w.belowFloor);
  return (
    <div className="space-y-4">
      <Card
        title="13-week rolling forecast（集團）"
        subtitle={`A/R 按 duedate + 收款 lag、A/P 按 duedate、payroll 28 號、recurring items（租金/MPF/股息）· 警戒線 = 各公司 floor 合計 ${hkdCompact(floor)}`}
        right={
          <Seg
            options={[
              { value: 7, label: "lag +7日" },
              { value: 14, label: "+14日" },
              { value: 21, label: "+21日" },
            ]}
            value={lag}
            onChange={setLag}
          />
        }
      >
        <ForecastChart data={chartData} floor={floor} />
        {firstBreach ? (
          <p className="text-[12px] text-critical mt-2">
            ⚠ 預計 {firstBreach.weekStart} 一週期末現金 {hkdCompact(firstBreach.closing)} 低於警戒線。
          </p>
        ) : (
          <p className="text-[12px] text-deltagood mt-2">✓ 13 週內預計現金高於警戒線。</p>
        )}
      </Card>
      <Card title="每週明細" subtitle="第 7 週起加入「預計新開票收款」假設（預算開票 × 95%，同一 lag）">
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">週始</th>
                <th className="num">A/R 收款</th>
                <th className="num">預計新收款</th>
                <th className="num">固定收入</th>
                <th className="num">A/P 付款</th>
                <th className="num">糧金</th>
                <th className="num">固定支出</th>
                <th className="num">其他開支</th>
                <th className="num">淨額</th>
                <th className="num">期末現金</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td className="text-left">{w.weekStart}</td>
                  <td className="num">{hkd(w.arCollections)}</td>
                  <td className="num text-ink2">{hkd(w.assumedNewCollections)}</td>
                  <td className="num text-ink2">{hkd(w.recurringIn)}</td>
                  <td className="num text-ink2">({hkd(w.apPayments)})</td>
                  <td className="num text-ink2">({hkd(w.payroll)})</td>
                  <td className="num text-ink2">({hkd(w.recurringOut)})</td>
                  <td className="num text-ink2">({hkd(w.otherOpex)})</td>
                  <td className={`num ${w.net < 0 ? "text-critical" : ""}`}>{hkd(w.net)}</td>
                  <td className={`num font-medium ${w.belowFloor ? "text-critical" : ""}`}>{hkd(w.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AgingTab({ subsidiary }: { subsidiary: number }) {
  const ar = arItems(subsidiary);
  const ap = apItems(subsidiary);
  const arB = ageBuckets(ar);
  const apB = ageBuckets(ap);
  const bucketData = (b: typeof arB) => [
    { label: "未到期", value: b.current },
    { label: "1–30", value: b.d1_30 },
    { label: "31–60", value: b.d31_60 },
    { label: "61–90", value: b.d61_90 },
    { label: "90+", value: b.d90p },
  ];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title={`A/R aging — 總額 ${hkdCompact(arB.total)}`} subtitle={`DSO ${dso(subsidiary)} 日 · 逾期>60日且>HK$50K 觸發警示（§7）`}>
        <AgingChart data={bucketData(arB)} />
        <ItemTable items={ar} kind="ar" />
      </Card>
      <Card title={`A/P aging — 總額 ${hkdCompact(apB.total)}`} subtitle={`DPO ${dpo(subsidiary)} 日`}>
        <AgingChart data={bucketData(apB)} />
        <ItemTable items={ap} kind="ap" />
      </Card>
    </div>
  );
}

function ItemTable({ items, kind }: { items: { txnId: string; entityName: string; dueDate: string; amountOpen: number }[]; kind: string }) {
  const sorted = [...items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).slice(0, 12);
  return (
    <div className="overflow-x-auto mt-2">
      <table className="report-table w-full text-[12px]">
        <thead>
          <tr>
            <th className="text-left">{kind === "ar" ? "客戶" : "供應商"}</th>
            <th className="text-left">到期日</th>
            <th className="num">未清金額</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((i) => (
            <tr key={i.txnId}>
              <td className="text-left">{i.entityName}</td>
              <td className="text-left text-ink2">{i.dueDate}</td>
              <td className="num">{hkd(i.amountOpen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 12 && <p className="text-[11px] text-ink3 mt-1.5">顯示最早到期 12 筆，共 {items.length} 筆。</p>}
    </div>
  );
}
