"use client";

// 業務線 Business Lines — 旅遊（Jervois M）、商品（CLS）、製作（704）、
// 聯營公司（數據層：lib/agency.ts，production 換 Supabase 讀取）。
// 圖表跟 charts.tsx mark specs：2px 線、hairline grid、hover tooltip、
// 單一 y 軸（不同單位嘅指標並排分圖，唔用雙軸）。

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts";
import { Card } from "@/components/ui";
import { associatesSummary, goodsLine, productionLine, travelLine } from "@/lib/agency";
import { hkd, hkdCompact, pct } from "@/lib/format";
import { fyMonthLabel } from "@/lib/fy";
import { usePalette } from "@/lib/theme";

const AXIS_FONT = { fontSize: 11 };

// ── shared bits ──────────────────────────────────────────────────────────────

/** section footer：標明真數來源同狀態 */
function SourceNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink3 mt-3">真數來源：{children}</p>;
}

/** 細 tile（card 內 YTD 摘要用，同總覽頁銀行 tile 一致寫法） */
function MiniTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-ringc px-2.5 py-2">
      <div className="text-[11px] text-ink3 truncate">{label}</div>
      <div className="text-[15px] font-semibold num">{value}</div>
      {note && <div className="text-[10px] text-ink3">{note}</div>}
    </div>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  const p = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: p.inkSecondary }}>
          <span aria-hidden className="inline-block w-4" style={{ height: 0, borderTop: `2px solid ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── 通用小圖（每個一條 series、一個單位，避免雙軸）──────────────────────────

/** HKD bar（單一 series） */
function MoneyBars({
  data,
  name,
  height = 200,
}: {
  data: { label: string; value: number }[];
  name: string;
  height?: number;
}) {
  const p = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
        <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
        <Bar name={name} dataKey="value" fill={p.series[0]} barSize={22} radius={[4, 4, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 單位可自定（%／x）嘅單一 series 線圖 */
function UnitLine({
  data,
  name,
  unit,
  domain = ["auto", "auto"],
  height = 200,
}: {
  data: { label: string; value: number }[];
  name: string;
  unit: string;
  domain?: [number | string, number | string];
  height?: number;
}) {
  const p = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
        <YAxis tickFormatter={(v: number) => `${v}${unit}`} tick={AXIS_FONT} tickLine={false} axisLine={false} width={44} domain={domain} />
        <Tooltip
          content={({ active, payload, label }) => (
            <ChartTooltip
              active={active}
              label={label}
              payload={payload?.map((r) => ({ ...r, value: `${r.value}${unit}` }))}
            />
          )}
          cursor={{ stroke: p.axis, strokeWidth: 1 }}
        />
        <Line
          name={name}
          dataKey="value"
          stroke={p.series[0]}
          strokeWidth={2}
          dot={{ r: 3, fill: p.series[0], stroke: p.surface, strokeWidth: 2 }}
          activeDot={{ r: 4.5, stroke: p.surface, strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 兩條 HKD series 並排 bar（day-rate 收入 vs 折舊） */
function PairedBars({
  data,
  nameA,
  nameB,
  height = 200,
}: {
  data: { label: string; a: number; b: number }[];
  nameA: string;
  nameB: string;
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: nameA, color: p.series[0] },
          { label: nameB, color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <Bar name={nameA} dataKey="a" fill={p.series[0]} barSize={14} radius={[4, 4, 0, 0]} />
          <Bar name={nameB} dataKey="b" fill={p.series[1]} barSize={14} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function BusinessLinesPage() {
  const travel = travelLine();
  const goods = goodsLine();
  const production = productionLine();
  const associates = associatesSummary();

  // 旅遊 YTD 摘要
  const tBookings = travel.reduce((s, r) => s + r.bookings, 0);
  const tRevenue = travel.reduce((s, r) => s + r.revenue, 0);
  const tNet = travel.reduce((s, r) => s + (r.revenue - r.direct), 0);
  const tTakeRate = tBookings ? (100 * tNet) / tBookings : 0;

  // 商品 YTD 摘要
  const gRevenue = goods.reduce((s, r) => s + r.revenue, 0);
  const gCogs = goods.reduce((s, r) => s + r.cogs, 0);
  const gGpPct = gRevenue ? (gRevenue - gCogs) / gRevenue : 0;
  const gLatest = goods[goods.length - 1];

  // 製作 YTD 摘要
  const pShootDays = production.reduce((s, r) => s + r.shootDays, 0);
  const pCapacity = production.reduce((s, r) => s + r.capacityDays, 0);
  const pRevenue = production.reduce((s, r) => s + r.dayRateRevenue, 0);
  const pDep = production.reduce((s, r) => s + r.depreciation, 0);

  // 聯營合計
  const aCost = associates.reduce((s, r) => s + r.investedCost, 0);
  const aCum = associates.reduce((s, r) => s + r.cumulativeDividends, 0);
  const aFy = associates.reduce((s, r) => s + r.fyDividends, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">業務線 Business Lines</h1>
        <p className="text-[12px] text-ink3">
          旅遊／商品／製作／聯營 — 非 agency 服務線嘅專屬指標 · FY2026/27 YTD（4–7 月）
        </p>
      </div>

      {/* §1 Jervois M 旅遊線 */}
      <Card
        title="Jervois M 旅遊線"
        subtitle="Travel line — 訂單 GMV、淨收入同 take rate（HKD）"
      >
        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniTile label="YTD 訂單總額 GMV" value={hkdCompact(tBookings)} />
          <MiniTile label="YTD 旅遊收入（61xx）" value={hkdCompact(tRevenue)} />
          <MiniTile label="YTD 平均 take rate" value={`${tTakeRate.toFixed(1)}%`} note={`淨收入 ${hkdCompact(tNet)} ÷ GMV`} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] text-ink2 mb-1">每月訂單總額（GMV）</div>
            <MoneyBars data={travel.map((r) => ({ label: fyMonthLabel(r.month), value: r.bookings }))} name="訂單總額" />
          </div>
          <div>
            <div className="text-[12px] text-ink2 mb-1">每月 take rate %（並排分圖，唔用雙軸）</div>
            <UnitLine
              data={travel.map((r) => ({ label: fyMonthLabel(r.month), value: r.takeRatePct }))}
              name="Take rate"
              unit="%"
              domain={[0, "auto"]}
            />
          </div>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          旅遊 COS 佔收入高達八成幾（機票／酒店代收代付），毛利率會被大額 pass-through 溝淡 —
          用 take rate（淨收入 ÷ 訂單 GMV）睇呢條線嘅健康度好過用 margin。
        </p>
        <SourceNote>駁通 NetSuite 即有（61xx 收入 + Tour Expense 成本）</SourceNote>
      </Card>

      {/* §2 CLS 商品線 */}
      <Card title="CLS 商品線" subtitle="Goods line — 存貨周轉、sell-through 同期末存貨">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniTile label="YTD 商品收入（62xx）" value={hkdCompact(gRevenue)} />
          <MiniTile label="YTD 毛利率" value={pct(gGpPct)} note={`毛利 ${hkdCompact(gRevenue - gCogs)}`} />
          <MiniTile label="最新存貨周轉（年化）" value={`${gLatest.turnoverX.toFixed(1)}x`} note={fyMonthLabel(gLatest.month)} />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="text-[12px] text-ink2 mb-1">存貨周轉（年化 COGS ÷ 期末存貨）</div>
            <UnitLine
              data={goods.map((r) => ({ label: fyMonthLabel(r.month), value: r.turnoverX }))}
              name="周轉次數"
              unit="x"
              domain={[0, "auto"]}
            />
          </div>
          <div>
            <div className="text-[12px] text-ink2 mb-1">Sell-through %</div>
            <UnitLine
              data={goods.map((r) => ({ label: fyMonthLabel(r.month), value: r.sellThroughPct }))}
              name="Sell-through"
              unit="%"
              domain={[0, 100]}
            />
          </div>
          <div>
            <div className="text-[12px] text-ink2 mb-1">期末存貨（21xx）</div>
            <MoneyBars data={goods.map((r) => ({ label: fyMonthLabel(r.month), value: r.inventoryEnd }))} name="期末存貨" />
          </div>
        </div>
        <SourceNote>駁通 NetSuite 即有（62xx + 21xx 存貨）</SourceNote>
      </Card>

      {/* §3 704 製作線 */}
      <Card title="704 製作線" subtitle="Production line — shoot day 使用率、day-rate 收入對折舊（重資產回本判斷）">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MiniTile label="YTD shoot days" value={`${pShootDays} 日`} note={`容量 ${pCapacity} 日（3 隊 crew）`} />
          <MiniTile label="YTD 平均使用率" value={`${pCapacity ? ((100 * pShootDays) / pCapacity).toFixed(1) : "0.0"}%`} />
          <MiniTile label="YTD day-rate 收入" value={hkdCompact(pRevenue)} />
          <MiniTile label="YTD 折舊" value={hkdCompact(pDep)} note={`收入 ÷ 折舊 = ${pDep ? (pRevenue / pDep).toFixed(1) : "—"}x`} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] text-ink2 mb-1">器材／shoot day 使用率</div>
            <UnitLine
              data={production.map((r) => ({ label: fyMonthLabel(r.month), value: r.utilPct }))}
              name="使用率"
              unit="%"
              domain={[0, 100]}
            />
          </div>
          <div>
            <div className="text-[12px] text-ink2 mb-1">Day-rate 收入 vs 折舊（每月對照）</div>
            <PairedBars
              data={production.map((r) => ({ label: fyMonthLabel(r.month), a: r.dayRateRevenue, b: r.depreciation }))}
              nameA="Day-rate 收入"
              nameB="折舊"
            />
          </div>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          重資產線嘅回本判斷：day-rate 收入要持續遠高於折舊（連同 crew 成本）先值得繼續加碼器材投資。
        </p>
        <SourceNote>shoot days 需人手輸入；財務數駁通即有</SourceNote>
      </Card>

      {/* §4 聯營公司 Associates */}
      <Card title="聯營公司 Associates" subtitle="投資成本、股息同簡單回報率（HKD）">
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">名稱</th>
                <th className="num">持股 %</th>
                <th className="num">投資成本</th>
                <th className="num">累計股息</th>
                <th className="num">本年股息</th>
                <th className="num">簡單回報率</th>
              </tr>
            </thead>
            <tbody>
              {associates.map((a) => {
                const ret = a.investedCost ? a.cumulativeDividends / a.investedCost : 0;
                return (
                  <tr key={a.name}>
                    <td className="text-left">{a.name}</td>
                    <td className="num">{a.sharePct}%</td>
                    <td className="num">{hkd(a.investedCost)}</td>
                    <td className="num">{hkd(a.cumulativeDividends)}</td>
                    <td className={`num ${a.fyDividends === 0 ? "text-ink3" : ""}`}>{hkd(a.fyDividends)}</td>
                    <td className={`num ${ret >= 1 ? "text-deltagood" : ""}`}>{pct(ret, 0)}</td>
                  </tr>
                );
              })}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">—</td>
                <td className="num">{hkd(aCost)}</td>
                <td className="num">{hkd(aCum)}</td>
                <td className="num">{hkd(aFy)}</td>
                <td className="num">{pct(aCost ? aCum / aCost : 0, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          簡單回報率 = 累計股息 ÷ 投資成本（未計持股公允值變動）；本年股息已計入 P&L「聯營公司股息/收益」。
        </p>
        <SourceNote>駁通 NetSuite 即有（13xxx 投資賬 + 股息收入）</SourceNote>
      </Card>
    </div>
  );
}
