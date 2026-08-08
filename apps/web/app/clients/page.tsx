"use client";

// 客戶 Clients — 客戶盈利能力（timesheet 分攤）、新客 vs 舊客、流失/保留、
// 信用風險 exposure、pitch 勝率。數據層見 lib/agency.ts（production 換 Supabase）。

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts";
import { Card, ExportButton, StatTile, exportCsv } from "@/components/ui";
import {
  churnStats,
  clientPnl,
  creditExposure,
  crossSell,
  newVsExisting,
  paymentBehaviour,
  pitchStats,
} from "@/lib/agency";
import { subsidiaryById } from "@/lib/dims";
import { hkd, hkdCompact } from "@/lib/format";
import { ACTUAL_MONTHS, fyMonthLabel } from "@/lib/fy";
import { usePalette } from "@/lib/theme";

const YTD = Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1);
const AXIS_FONT = { fontSize: 11 };

// ── 小組件 ───────────────────────────────────────────────────────────────────

function IntercoBadge() {
  return (
    <span className="ml-1.5 align-middle text-[10px] text-ink3 border border-ringc rounded px-1 py-px whitespace-nowrap">
      集團內
    </span>
  );
}

function SourceNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink3 mt-2">真數來源：{children}</p>;
}

function MiniTile({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-ringc px-3 py-2.5">
      <div className="text-[11px] text-ink3">{label}</div>
      <div className={`text-xl font-semibold num ${bad ? "text-critical" : ""}`}>{value}</div>
      {note && <div className="text-[10px] text-ink3 mt-0.5">{note}</div>}
    </div>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  const p = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: p.inkSecondary }}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── 圖表（跟 charts.tsx 寫法：2px 線、≤24px bar、4px 圓角 data-end、ink 字色）──

function NewVsExistingChart({
  data,
  height = 230,
}: {
  data: { label: string; existingRev: number; newRev: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "舊客收入", color: p.series[0] },
          { label: "新客收入", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          {/* stacked：段與段之間用 surface stroke 造 2px 間隔 */}
          <Bar name="舊客收入" dataKey="existingRev" stackId="rev" fill={p.series[0]} barSize={22} stroke={p.surface} strokeWidth={1} />
          <Bar name="新客收入" dataKey="newRev" stackId="rev" fill={p.series[1]} barSize={22} radius={[4, 4, 0, 0]} stroke={p.surface} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PitchBars({
  data,
  height = 190,
}: {
  data: { label: string; pitches: number; won: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Pitch 數", color: p.series[0] },
          { label: "贏單", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis allowDecimals={false} tick={AXIS_FONT} tickLine={false} axisLine={false} width={30} />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((r) => ({ ...r, value: `${r.value} 次` }))}
              />
            )}
            cursor={{ fill: p.grid, opacity: 0.4 }}
          />
          <Bar name="Pitch 數" dataKey="pitches" fill={p.series[0]} barSize={14} radius={[4, 4, 0, 0]} />
          <Bar name="贏單" dataKey="won" fill={p.series[1]} barSize={14} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 頁面 ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  // 1) 客戶盈利能力 — 預設按利潤升序（蝕錢客排頭）
  const pnl = [...clientPnl(-1, YTD)].sort((a, b) => a.margin - b.margin);
  const losers = pnl.filter((r) => r.margin < 0);
  const lossTotal = losers.reduce((a, r) => a + r.margin, 0);
  const best = pnl[pnl.length - 1];

  // 2) 新客 vs 舊客
  const nve = newVsExisting();
  const nveData = nve.map((d) => ({ label: fyMonthLabel(d.month), existingRev: d.existingRev, newRev: d.newRev }));
  const newYtd = nve.reduce((a, d) => a + d.newRev, 0);
  const totalYtd = nve.reduce((a, d) => a + d.newRev + d.existingRev, 0);
  const newSharePct = totalYtd ? (100 * newYtd) / totalYtd : 0;

  // 3) 流失／保留
  const churn = churnStats();

  // 4) 信用風險
  const credit = creditExposure();

  // 5) Pitch
  const pitch = pitchStats();
  const pitchCost = pitch.rows.reduce((a, r) => a + r.hoursCost, 0);
  const pitchData = pitch.rows.map((r) => ({ label: fyMonthLabel(r.month), pitches: r.pitches, won: r.won }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">客戶 Clients</h1>
        <p className="text-[12px] text-ink3">客戶盈利・留存・信用風險・Pitch 效益 · FY2026/27 YTD（4–7 月）· HKD</p>
      </div>

      {/* ── 1. 客戶盈利能力 ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          label="蝕錢客數目"
          value={`${losers.length} 個`}
          note={`共 ${pnl.length} 個客（timesheet 分攤後）`}
        />
        <StatTile
          label="蝕錢客合共蝕咗"
          value={hkdCompact(lossTotal)}
          note="收入 − 直接成本 − 分攤人力成本"
        />
        <StatTile
          label="最高利潤客"
          value={hkdCompact(best.margin)}
          note={`${best.client.name} · margin ${best.marginPct.toFixed(1)}%`}
        />
      </div>

      <Card
        title="客戶盈利能力 Client Profitability"
        subtitle="全集團 · YTD（4–7 月）· 預設按利潤升序 — 蝕錢客排頭"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                "client_profitability_ytd.csv",
                ["客戶", "公司", "收入", "直接成本", "分攤人力成本", "利潤", "Margin %"],
                pnl.map((r) => [
                  r.client.name,
                  subsidiaryById(r.client.subsidiaryId)?.short ?? "",
                  r.revenue,
                  r.directCost,
                  r.staffCost,
                  r.margin,
                  `${r.marginPct.toFixed(1)}%`,
                ])
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
                <th className="text-left">公司</th>
                <th className="num">收入</th>
                <th className="num">直接成本</th>
                <th className="num">分攤人力成本</th>
                <th className="num">利潤</th>
                <th className="num">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {pnl.map((r) => {
                const bad = r.margin < 0;
                return (
                  <tr key={r.client.id} className={bad ? "text-critical" : ""}>
                    <td className="text-left">
                      {r.client.name}
                      {r.client.isInterco && <IntercoBadge />}
                    </td>
                    <td className={`text-left ${bad ? "" : "text-ink2"}`}>
                      {subsidiaryById(r.client.subsidiaryId)?.short}
                    </td>
                    <td className="num">{hkd(r.revenue)}</td>
                    <td className="num">{hkd(r.directCost)}</td>
                    <td className="num">{hkd(r.staffCost)}</td>
                    <td className={`num ${bad ? "font-semibold" : ""}`}>{hkd(r.margin)}</td>
                    <td className="num">{r.marginPct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SourceNote>需 timesheet 數據（PL by team workbook／NetSuite Time Tracking）——人力成本按工時分攤</SourceNote>
      </Card>

      {/* ── 2 + 3. 新舊客／流失保留 ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="新客 vs 舊客收入" subtitle="FY2026/27 逐月 · 新客 = 本財年首次開票客戶">
          <div className="flex items-baseline justify-between border-b border-grid pb-2 mb-3">
            <span className="text-[12px] text-ink2">新客貢獻（YTD）</span>
            <span className="text-[15px] font-semibold num">
              {newSharePct.toFixed(1)}%
              <span className="text-[11px] text-ink3 font-normal ml-1.5">{hkdCompact(newYtd)}</span>
            </span>
          </div>
          <NewVsExistingChart data={nveData} />
          <SourceNote>駁通 NetSuite 即有（GL/AR/AP）——以客戶首次開票日期判別新舊</SourceNote>
        </Card>

        <Card title="客戶流失／保留" subtitle="對上財年（FY2025/26）比較">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <MiniTile
              label="客戶保留率"
              value={`${churn.clientRetentionPct.toFixed(1)}%`}
              note={`本年流失 ${churn.lostClients.length} 個客`}
            />
            <MiniTile
              label="收入保留率"
              value={`${churn.revenueRetentionPct.toFixed(1)}%`}
              note="舊客收入年化 ÷ 上年全年收入"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">流失客</th>
                  <th className="num">上年收入</th>
                </tr>
              </thead>
              <tbody>
                {churn.lostClients.map((l) => (
                  <tr key={l.client.id}>
                    <td className="text-left">
                      {l.client.name}
                      <span className="text-[11px] text-ink3 ml-1.5">
                        {subsidiaryById(l.client.subsidiaryId)?.short}
                      </span>
                    </td>
                    <td className="num">{hkd(l.lastFyRevenue)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td className="text-left">合計</td>
                  <td className="num">{hkd(churn.lostClients.reduce((a, l) => a + l.lastFyRevenue, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <SourceNote>駁通 NetSuite 即有（GL/AR/AP）——對比兩個財年嘅發票客戶集合</SourceNote>
        </Card>
      </div>

      {/* ── 4. 信用風險 exposure ────────────────────────────────────────── */}
      <Card
        title="信用風險 Exposure"
        subtitle="未收 A/R + 已承諾媒體投放 vs 信用額度 · 使用率 >90% 紅、>75% 黃"
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">客戶</th>
                <th className="num">未收 A/R</th>
                <th className="num">已承諾媒體投放</th>
                <th className="num">信用額度</th>
                <th className="num">使用率 %</th>
              </tr>
            </thead>
            <tbody>
              {credit.map((r) => {
                const util = r.utilisationPct;
                const utilCls =
                  util == null ? "text-ink3" : util > 90 ? "text-critical font-semibold" : util > 75 ? "text-warn font-medium" : "";
                return (
                  <tr key={r.client.id}>
                    <td className="text-left">
                      {r.client.name}
                      <span className="text-[11px] text-ink3 ml-1.5">
                        {subsidiaryById(r.client.subsidiaryId)?.short}
                      </span>
                      {r.client.isInterco && <IntercoBadge />}
                    </td>
                    <td className="num">{hkd(r.arOpen)}</td>
                    <td className="num">{r.committedMedia ? hkd(r.committedMedia) : <span className="text-ink3">—</span>}</td>
                    <td className="num">
                      {r.client.creditLimitK != null ? hkd(r.client.creditLimitK * 1000) : <span className="text-ink3">未設限額</span>}
                    </td>
                    <td className={`num ${utilCls}`}>{util == null ? "—" : `${util.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SourceNote>A/R 駁通即有；信用額度需人手輸入</SourceNote>
      </Card>

      {/* ── 5. Pitch 勝率 ───────────────────────────────────────────────── */}
      <Card title="Pitch 勝率" subtitle="YTD（4–7 月）· 成本 = 內部工時成本估算">
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2 content-start">
            <MiniTile label="Win rate" value={`${pitch.winRatePct.toFixed(1)}%`} note={`${pitch.rows.reduce((a, r) => a + r.won, 0)} 贏 ÷ ${pitch.rows.reduce((a, r) => a + r.pitches, 0)} pitch`} />
            <MiniTile label="Pitch 總成本" value={hkdCompact(pitchCost)} note="4 個月合計工時成本" />
            <MiniTile label="Cost per win" value={hkdCompact(pitch.costPerWin)} note="總成本 ÷ 贏單數" />
          </div>
          <div>
            <PitchBars data={pitchData} />
          </div>
        </div>
        <SourceNote>需人手輸入（NetSuite opportunities 未啟用）</SourceNote>
      </Card>

      {/* ── 6. 找數行為 ─────────────────────────────────────────────────── */}
      <PaymentBehaviourCard />

      {/* ── 7. Cross-sell 滲透 ──────────────────────────────────────────── */}
      <CrossSellCard />
    </div>
  );
}

const CS_SUBS = [1, 2, 5, 7, 8];

function PaymentBehaviourCard() {
  const rows = paymentBehaviour();
  const worsening = rows.filter((r) => r.deltaDays >= 8);
  return (
    <Card
      title="找數行為 Payment Behaviour"
      subtitle="每客實際找數日數趨勢 — aging 話你知邊個已經遲，呢度話你知邊個開始遲"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-w-xl">
        <MiniTile
          label="惡化中客戶"
          value={`${worsening.length} 個`}
          note="近 3 個月比之前慢 ≥8 日"
          bad={worsening.length > 0}
        />
        <MiniTile
          label="惡化客戶未收數"
          value={hkdCompact(worsening.reduce((a, r) => a + r.arOpen, 0))}
          note="提早跟收，好過遲啲追"
          bad
        />
      </div>
      <div className="overflow-x-auto">
        <table className="report-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">客戶</th>
              <th className="num">賬期</th>
              <th className="num">之前平均</th>
              <th className="num">近 3 個月</th>
              <th className="num">變化</th>
              <th className="num">未收 A/R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.deltaDays >= 8;
              const good = r.deltaDays <= -3;
              return (
                <tr key={r.client.id}>
                  <td className={`text-left ${bad ? "text-critical font-medium" : ""}`}>{r.client.name}</td>
                  <td className="num text-ink3">{r.termsDays} 日</td>
                  <td className="num text-ink2">{r.avgDaysPrior} 日</td>
                  <td className={`num ${bad ? "text-critical font-semibold" : ""}`}>{r.avgDaysRecent} 日</td>
                  <td className={`num ${bad ? "text-critical" : good ? "text-deltagood" : "text-ink3"}`}>
                    {r.deltaDays > 0 ? `+${r.deltaDays}` : r.deltaDays} 日
                  </td>
                  <td className="num">{hkd(r.arOpen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SourceNote>駁通 NetSuite 即有（invoice → payment 配對歷史）</SourceNote>
    </Card>
  );
}

function CrossSellCard() {
  const rows = crossSell();
  const single = rows.filter((r) => r.subCount === 1);
  return (
    <Card
      title="Cross-sell 滲透 Cross-sell Matrix"
      subtitle="每個品牌用緊集團幾多間公司 — 最平嘅增長嚟自現有客"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-w-xl">
        <MiniTile
          label="只用 1 間公司嘅大客"
          value={`${single.length} / ${rows.length}`}
          note="全部係 cross-sell 機會"
        />
        <MiniTile
          label="單一公司大客收入"
          value={hkdCompact(single.reduce((a, r) => a + r.totalRev, 0))}
          note="YTD — 介紹俾兄弟公司嘅本錢"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="report-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">品牌</th>
              <th className="text-left">行業</th>
              {CS_SUBS.map((id) => (
                <th key={id} className="num">{subsidiaryById(id)?.short}</th>
              ))}
              <th className="num">用咗</th>
              <th className="num">YTD 合計</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="text-left">{r.name}</td>
                <td className="text-left text-ink3">{r.sector}</td>
                {CS_SUBS.map((id) => {
                  const v = r.revBySub[id] ?? 0;
                  return (
                    <td key={id} className={`num ${v ? "" : "text-ink3/40"}`}>
                      {v ? hkdCompact(v) : "·"}
                    </td>
                  );
                })}
                <td className={`num font-medium ${r.subCount >= 2 ? "text-deltagood" : "text-ink3"}`}>
                  {r.subCount}/5
                </td>
                <td className="num">{hkd(r.totalRev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote>駁通 NetSuite 即有（跨公司 customer 名對照合併）</SourceNote>
    </Card>
  );
}
