"use client";

// 營運 Operations — agency 三大比率、utilisation、實效時薪、超服務、
// freelance 比率、人均產能（數據層：lib/agency.ts，production 換 Supabase 讀取）。

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts";
import { Card } from "@/components/ui";
import {
  agiPerFeeEarner,
  effectiveRate,
  freelanceRatio,
  headcountTrend,
  overServicing,
  ratioSuite,
  utilisationByTeam,
  utilisationTrend,
} from "@/lib/agency";
import { hkd, hkdCompact } from "@/lib/format";
import { ACTUAL_MONTHS, fyMonthLabel } from "@/lib/fy";
import { usePalette } from "@/lib/theme";

const YTD = Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1);
const UTIL_TARGET = 85; // 使用率目標 %

// ── shared bits ──────────────────────────────────────────────────────────────

const AXIS_FONT = { fontSize: 11 };

/** section footer：標明真數來源同狀態 */
function SourceNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink3 mt-3">真數來源：{children}</p>;
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

// ── ratio tiles（§1）────────────────────────────────────────────────────────

/** 大 tile：實際值 vs 健康區間，區內綠／出界紅 */
function RatioTile({
  label,
  en,
  valuePct,
  lo,
  hi,
}: {
  label: string;
  en: string;
  valuePct: number;
  lo: number;
  hi: number;
}) {
  const inside = valuePct >= lo && valuePct <= hi;
  const status = inside ? "健康區內" : valuePct > hi ? "高於健康區" : "低於健康區";
  return (
    <div className="rounded-xl border border-ringc px-4 py-3.5">
      <div className="text-[12px] text-ink2">
        {label} <span className="text-[10px] text-ink3">{en}</span>
      </div>
      <div className={`text-2xl font-semibold num mt-1 ${inside ? "text-deltagood" : "text-critical"}`}>
        {valuePct.toFixed(1)}%
      </div>
      <div className={`text-[11px] mt-1 ${inside ? "text-deltagood" : "text-critical"}`}>{status}</div>
      <div className="text-[11px] text-ink3 mt-0.5">
        健康區 {lo}–{hi}%
      </div>
    </div>
  );
}

// ── charts（跟 charts.tsx mark specs：2px 線、hairline grid、hover tooltip）──

function UtilTrendChart({ data, height = 210 }: { data: { label: string; value: number }[]; height?: number }) {
  const p = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
        <YAxis tickFormatter={(v: number) => `${v}%`} tick={AXIS_FONT} tickLine={false} axisLine={false} width={44} domain={[0, 100]} />
        <Tooltip
          content={({ active, payload, label }) => (
            <ChartTooltip
              active={active}
              label={label}
              payload={payload?.map((r) => ({ ...r, value: `${r.value}%` }))}
            />
          )}
          cursor={{ stroke: p.axis, strokeWidth: 1 }}
        />
        <ReferenceLine y={UTIL_TARGET} stroke={p.critical} strokeWidth={1.5} strokeDasharray="5 4" />
        <Line
          name="集團使用率"
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

function FreelanceBars({ data, height = 220 }: { data: { label: string; freelanceCost: number; internalCost: number }[]; height?: number }) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "外判／freelance 成本", color: p.series[0] },
          { label: "內部員工成本", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <Bar name="外判／freelance 成本" dataKey="freelanceCost" fill={p.series[0]} barSize={14} radius={[4, 4, 0, 0]} />
          <Bar name="內部員工成本" dataKey="internalCost" fill={p.series[1]} barSize={14} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function HeadcountChart({ data, height = 200 }: { data: { label: string; total: number; feeEarners: number }[]; height?: number }) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "總人數", color: p.series[0] },
          { label: "Fee earners", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tick={AXIS_FONT} tickLine={false} axisLine={false} width={36} domain={["dataMin - 4", "dataMax + 4"]} />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((r) => ({ ...r, value: `${r.value} 人` }))}
              />
            )}
            cursor={{ stroke: p.axis, strokeWidth: 1 }}
          />
          <Line name="Fee earners" dataKey="feeEarners" stroke={p.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} />
          <Line name="總人數" dataKey="total" stroke={p.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── utilisation 水平 bar row（div-based bar meter）───────────────────────────

function TeamUtilBar({ team, billable, capacity, utilPct }: { team: string; billable: number; capacity: number; utilPct: number }) {
  const low = utilPct < 65;
  const barColor = utilPct >= UTIL_TARGET ? "bg-good" : low ? "bg-critical" : "bg-accent";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink2 truncate">{team}</span>
        <span className={`num font-semibold shrink-0 ${low ? "text-critical" : ""}`}>{utilPct.toFixed(1)}%</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-ink3/15 mt-1">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(utilPct, 100)}%` }} />
        {/* 85% 目標線 */}
        <div className="absolute inset-y-0 w-px bg-critical/70" style={{ left: `${UTIL_TARGET}%` }} aria-hidden />
      </div>
      <div className="text-[10px] text-ink3 mt-0.5 num text-left">
        {billable.toLocaleString("en-HK")} / {capacity.toLocaleString("en-HK")} 小時
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const ratios = ratioSuite(YTD);
  const teams = utilisationByTeam();
  const utilTrend = utilisationTrend().map((d) => ({ label: fyMonthLabel(d.month), value: d.utilPct }));
  const er = effectiveRate();
  const overs = overServicing();
  const fl = freelanceRatio();
  const flLatest = fl[fl.length - 1];
  const flChart = fl.map((d) => ({ label: fyMonthLabel(d.month), freelanceCost: d.freelanceCost, internalCost: d.internalCost }));
  const perHead = agiPerFeeEarner(YTD);
  const hc = headcountTrend();
  const hcChart = hc.map((d) => ({ label: fyMonthLabel(d.month), total: d.total, feeEarners: d.feeEarners }));
  const perHeadInside = perHead.annualised >= 700_000 && perHead.annualised <= 1_000_000;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">
        營運 Operations <span className="text-[12px] font-normal text-ink3">FY2026/27 YTD（4–7 月）· HKD</span>
      </h1>

      {/* 1 ── Agency 三大比率 */}
      <Card title="Agency 三大比率" subtitle="全集團 YTD · 全部以 AGI 為分母（§6.2）">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <RatioTile label="員工成本 ÷ AGI" en="Staff cost / AGI" valuePct={ratios.staffToAgiPct} lo={50} hi={60} />
          <RatioTile label="Overhead ÷ AGI" en="Overhead / AGI" valuePct={ratios.overheadToAgiPct} lo={20} hi={25} />
          <RatioTile label="EBITDA margin on AGI" en="EBITDA / AGI" valuePct={ratios.ebitdaToAgiPct} lo={15} hi={20} />
        </div>
        <SourceNote>駁通 NetSuite 即有（GL）</SourceNote>
      </Card>

      {/* 2 ── 人手使用率 */}
      <Card title="人手使用率 Utilisation" subtitle={`billable ÷ capacity 小時（YTD 合計）· 目標 ${UTIL_TARGET}%（bar 上直線）`}>
        <div className="grid lg:grid-cols-2 gap-x-8 gap-y-4">
          <div className="space-y-3">
            {teams.map((t) => (
              <TeamUtilBar key={t.team} team={t.team} billable={t.billableHours} capacity={t.capacityHours} utilPct={t.utilPct} />
            ))}
            <p className="text-[11px] text-ink3">紅色 = 使用率低於 65%，明顯偏低；綠色 = 達 {UTIL_TARGET}% 目標。</p>
          </div>
          <div>
            <div className="text-[12px] text-ink2 mb-1">集團使用率 — 逐月（虛線 = {UTIL_TARGET}% 目標）</div>
            <UtilTrendChart data={utilTrend} />
          </div>
        </div>
        <SourceNote>需 timesheet 數據（PL by team workbook／NetSuite Time Tracking）</SourceNote>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 3 ── 實效時薪 */}
        <Card title="實效時薪 Effective rate" subtitle="AGI ÷ billable hours（YTD）">
          <div className="rounded-xl border border-ringc px-4 py-3.5 mb-3">
            <div className="text-[12px] text-ink2">
              集團實效時薪 <span className="text-[10px] text-ink3">Overall blended rate</span>
            </div>
            <div className="text-2xl font-semibold num mt-1">${hkd(er.overall)}/hr</div>
            <div className="text-[11px] text-ink3 mt-1">合併 AGI（含 elimination）÷ 各 team billable hours 合計</div>
          </div>
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">Team</th>
                  <th className="num">AGI（YTD）</th>
                  <th className="num">Billable hrs</th>
                  <th className="num">HK$/hr</th>
                </tr>
              </thead>
              <tbody>
                {er.byTeam.map((t) => (
                  <tr key={t.team}>
                    <td className="text-left">{t.team}</td>
                    <td className="num">{hkdCompact(t.agi)}</td>
                    <td className="num">{t.billableHours.toLocaleString("en-HK")}</td>
                    <td className="num">${hkd(t.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote>需 timesheet 數據（PL by team workbook／NetSuite Time Tracking）</SourceNote>
        </Card>

        {/* 4 ── 超服務 */}
        <Card title="超服務 Over-servicing" subtitle="retainer 客：投入時間成本 vs YTD fee（ratio 超過 100% = 蝕住做）">
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">客戶</th>
                  <th className="num">YTD fee</th>
                  <th className="num">時間成本</th>
                  <th className="num">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {overs.map((o) => {
                  const over = o.ratioPct > 100;
                  return (
                    <tr key={o.client.id}>
                      <td className="text-left">{o.client.name}</td>
                      <td className="num">{hkdCompact(o.feeYtd)}</td>
                      <td className="num text-ink2">{hkdCompact(o.timeCostYtd)}</td>
                      <td className={`num font-medium ${over ? "text-critical" : ""}`}>{o.ratioPct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink3 mt-2">時間成本 = timesheet 分攤員工成本 × 1.12 loading（薪金＋MPF＋直接 oncost）。</p>
          <SourceNote>需 timesheet 數據（PL by team workbook／NetSuite Time Tracking）</SourceNote>
        </Card>
      </div>

      {/* 5 ── Freelance 比率 */}
      <Card title="Freelance 比率" subtitle="外判／freelance 成本 vs 內部員工成本 — 逐月">
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2">
            <FreelanceBars data={flChart} />
          </div>
          <div className="rounded-xl border border-ringc px-4 py-3.5">
            <div className="text-[12px] text-ink2">
              最新月（{fyMonthLabel(flLatest.month)}）外判佔比 <span className="text-[10px] text-ink3">Freelance ratio</span>
            </div>
            <div className="text-2xl font-semibold num mt-1">{flLatest.ratioPct.toFixed(1)}%</div>
            <div className="text-[11px] text-ink3 mt-1">
              外判成本 {hkdCompact(flLatest.freelanceCost)} ÷（外判＋內部員工成本）
            </div>
            <div className="text-[11px] text-ink3 mt-0.5">
              {fyMonthLabel(fl[0].month)} {fl[0].ratioPct.toFixed(1)}% → {fyMonthLabel(flLatest.month)} {flLatest.ratioPct.toFixed(1)}%，連月趨升，留意固定人手 vs 外判結構
            </div>
          </div>
        </div>
        <SourceNote>駁通 NetSuite 即有（外判成本 GL 賬戶）</SourceNote>
      </Card>

      {/* 6 ── 人均產能 */}
      <Card title="人均產能" subtitle="AGI per fee earner（年化）＋ headcount 走勢">
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <div className="rounded-xl border border-ringc px-4 py-3.5">
            <div className="text-[12px] text-ink2">
              AGI per fee earner（年化） <span className="text-[10px] text-ink3">Annualised</span>
            </div>
            <div className={`text-2xl font-semibold num mt-1 ${perHeadInside ? "text-deltagood" : "text-critical"}`}>
              {hkdCompact(perHead.annualised)}
            </div>
            <div className={`text-[11px] mt-1 ${perHeadInside ? "text-deltagood" : "text-critical"}`}>
              {perHeadInside ? "健康區內" : perHead.annualised > 1_000_000 ? "高於健康區" : "低於健康區"}
            </div>
            <div className="text-[11px] text-ink3 mt-0.5">健康區 HK$700K–1M／人／年</div>
            <div className="text-[11px] text-ink3 mt-1">
              YTD AGI {hkdCompact(perHead.agi)} · fee earners {perHead.feeEarners} 人
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="text-[12px] text-ink2 mb-1">Headcount — 逐月</div>
            <HeadcountChart data={hcChart} />
          </div>
        </div>
        <SourceNote>AGI 駁通即有；headcount 需人手輸入（每月可變）</SourceNote>
      </Card>
    </div>
  );
}
