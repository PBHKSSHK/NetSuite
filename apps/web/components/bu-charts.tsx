"use client";

// BU 模組圖表：BU 堆疊月度 bar、多 BU 折線、Bridge 瀑布圖、分攤方法對比 bar。

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePalette } from "@/lib/theme";
import { hkdCompact } from "@/lib/format";
import { ChartTooltip } from "./charts";
import { BU_ORDER, buLabel, type BuCode } from "@/lib/bu";

const AXIS_FONT = { fontSize: 11 };

/** BU → 固定色位（categorical slots，跨頁一致） */
export function buColor(p: ReturnType<typeof usePalette>, bu: BuCode | "TOTAL"): string {
  const idx: Record<string, number> = { EPR: 0, PROD: 1, JM: 2, CLS: 3, SHARED: 6, OTHER: 4, TOTAL: 7 };
  return bu === "SHARED" ? p.inkMuted : p.series[idx[bu] ?? 7];
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  const p = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: p.inkSecondary }}>
          <span aria-hidden className="inline-block w-4" style={{ height: 0, borderTop: `${it.dashed ? "2px dashed" : "3px solid"} ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** 每月 BU 堆疊（收入 / EBITDA 等），bus 決定顯示邊幾個 */
export function BuStackedChart({ data, bus, height = 250 }: { data: ({ label: string } & Partial<Record<BuCode, number | null>>)[]; bus: BuCode[]; height?: number }) {
  const p = usePalette();
  return (
    <div>
      <Legend items={bus.map((b) => ({ label: buLabel(b), color: buColor(p, b) }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} stackOffset="sign">
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <ReferenceLine y={0} stroke={p.axis} />
          {bus.map((b) => (
            <Bar key={b} name={buLabel(b)} dataKey={b} stackId="s" fill={buColor(p, b)} barSize={22} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 多 BU 折線（本年實線）+ 可選集團合計虛線 */
export function BuLinesChart({ data, bus, showTotal = false, height = 250 }: { data: ({ label: string; TOTAL?: number | null } & Partial<Record<BuCode, number | null>>)[]; bus: BuCode[]; showTotal?: boolean; height?: number }) {
  const p = usePalette();
  return (
    <div>
      <Legend items={[...bus.map((b) => ({ label: buLabel(b), color: buColor(p, b) })), ...(showTotal ? [{ label: "集團合計", color: p.inkMuted, dashed: true }] : [])]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: p.axis, strokeWidth: 1 }} />
          <ReferenceLine y={0} stroke={p.axis} />
          {bus.map((b) => (
            <Line key={b} name={buLabel(b)} dataKey={b} stroke={buColor(p, b)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} connectNulls={false} />
          ))}
          {showTotal && <Line name="集團合計" dataKey="TOTAL" stroke={p.inkMuted} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 瀑布圖：steps 每步 delta，首尾為 total */
export function WaterfallChart({ steps, height = 260 }: { steps: { label: string; value: number; total?: boolean }[]; height?: number }) {
  const p = usePalette();
  let running = 0;
  const data = steps.map((s) => {
    if (s.total) {
      running = s.value;
      return { label: s.label, base: Math.min(0, s.value), bar: Math.abs(s.value), fill: p.series[0], total: true, value: s.value };
    }
    const start = running;
    running += s.value;
    const lo = Math.min(start, running);
    const hi = Math.max(start, running);
    return { label: s.label, base: lo, bar: hi - lo, fill: s.value >= 0 ? p.good : p.critical, total: false, value: s.value };
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: p.axis }} interval={0} />
        <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
        <Tooltip
          content={({ active, payload, label }) => {
            const row = payload?.[0]?.payload as { value: number; fill: string } | undefined;
            return <ChartTooltip active={active} label={label} payload={row ? [{ name: "金額", value: row.value, color: row.fill }] : []} />;
          }}
          cursor={{ fill: p.grid, opacity: 0.4 }}
        />
        <ReferenceLine y={0} stroke={p.axis} />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="bar" stackId="w" barSize={26} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 分攤方法對比：每個 BU 幾條 bar（一個 series 一種 key） */
export function AllocCompareChart({ data, series, height = 230 }: { data: { label: string; [k: string]: number | string }[]; series: { key: string; label: string }[]; height?: number }) {
  const p = usePalette();
  const ramp = p.mode === "light" ? ["#2a78d6", "#5598e7", "#86b6ef", "#b9d3f5"] : ["#3987e5", "#6da7ec", "#86b6ef", "#256abf"];
  return (
    <div>
      <Legend items={series.map((s, i) => ({ label: s.label, color: ramp[i % ramp.length] }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          {series.map((s, i) => (
            <Bar key={s.key} name={s.label} dataKey={s.key} fill={ramp[i % ramp.length]} barSize={12} radius={[4, 4, 0, 0]} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export { BU_ORDER };
