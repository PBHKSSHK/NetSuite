"use client";

// Recharts wrappers following the dataviz mark specs: 2px lines, ≤24px bars with
// 4px rounded data-ends, hairline solid grid, hover tooltips everywhere, legends
// for ≥2 series, text in ink tokens (never the series colour).

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
import { usePalette } from "@/lib/theme";
import { hkdCompact } from "@/lib/format";

// ── shared pieces ────────────────────────────────────────────────────────────

interface TooltipRow {
  name?: string | number;
  value?: number | string;
  color?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
}) {
  const p = usePalette();
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{ background: p.surface, borderColor: p.grid, color: p.inkPrimary }}
      className="rounded-lg border px-3 py-2 shadow-md text-[12px]"
    >
      <div style={{ color: p.inkSecondary }} className="mb-1">{label}</div>
      {payload
        .filter((r) => r.value != null)
        .map((r, i) => (
          <div key={i} className="flex items-center gap-2 num">
            <span
              aria-hidden
              style={{ background: r.color }}
              className="inline-block h-2 w-2 rounded-full"
            />
            <span style={{ color: p.inkSecondary }}>{r.name}</span>
            <span className="ml-auto font-medium" style={{ color: p.inkPrimary }}>
              {typeof r.value === "number" ? hkdCompact(r.value) : r.value}
            </span>
          </div>
        ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  const p = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: p.inkSecondary }}>
          <span
            aria-hidden
            className="inline-block w-4"
            style={{
              height: 0,
              borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.color}`,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const AXIS_FONT = { fontSize: 11 };

// ── monthly trend: actual vs budget vs last year ─────────────────────────────

export function MonthTrendChart({
  data,
  height = 240,
}: {
  data: { label: string; actual: number | null; budget: number; ly: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <Legend
        items={[
          { label: "實際", color: p.series[0] },
          { label: "預算", color: p.inkMuted, dashed: true },
          { label: "去年", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: p.axis, strokeWidth: 1 }} />
          <Line name="去年" dataKey="ly" stroke={p.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} />
          <Line name="預算" dataKey="budget" stroke={p.inkMuted} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} />
          <Line name="實際" dataKey="actual" stroke={p.series[0]} strokeWidth={2.5} dot={false} activeDot={{ r: 4.5, stroke: p.surface, strokeWidth: 2 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── single-series area (bank balance 30d) ────────────────────────────────────

export function BankTrendChart({ data, height = 200 }: { data: { label: string; total: number }[]; height?: number }) {
  const p = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} minTickGap={28} />
        <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} domain={["auto", "auto"]} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: p.axis, strokeWidth: 1 }} />
        <Line name="集團現金" dataKey="total" stroke={p.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4.5, stroke: p.surface, strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── actual vs budget bars (BvA) ──────────────────────────────────────────────

export function ActualVsBudgetBars({
  data,
  height = 240,
}: {
  data: { label: string; actual: number | null; budget: number }[];
  height?: number;
}) {
  const p = usePalette();
  const budgetFill = p.mode === "light" ? "#9ec5f4" : "#1c5cab"; // sequential steps of the same hue
  return (
    <div>
      <Legend
        items={[
          { label: "實際", color: p.series[0] },
          { label: "預算", color: budgetFill },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <Bar name="預算" dataKey="budget" fill={budgetFill} barSize={14} radius={[4, 4, 0, 0]} />
          <Bar name="實際" dataKey="actual" fill={p.series[0]} barSize={14} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── aging buckets (ordinal blue ramp — magnitude of overdue-ness) ────────────

const AGING_RAMP_LIGHT = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
const AGING_RAMP_DARK = ["#86b6ef", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

export function AgingChart({
  data,
  height = 190,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const p = usePalette();
  const ramp = p.mode === "light" ? AGING_RAMP_LIGHT : AGING_RAMP_DARK;
  const withFill = data.map((d, i) => ({ ...d, fill: ramp[Math.min(i, ramp.length - 1)] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={withFill} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
        <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
        <Bar name="金額" dataKey="value" barSize={22} radius={[4, 4, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── 13-week forecast line vs floor ───────────────────────────────────────────

export function ForecastChart({
  data,
  floor,
  height = 240,
}: {
  data: { label: string; closing: number }[];
  floor: number;
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <Legend
        items={[
          { label: "預計期末現金", color: p.series[0] },
          { label: "最低現金警戒線", color: p.critical },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} minTickGap={20} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: p.axis, strokeWidth: 1 }} />
          <ReferenceLine y={floor} stroke={p.critical} strokeWidth={1.5} />
          <Line
            name="預計期末現金"
            dataKey="closing"
            stroke={p.series[0]}
            strokeWidth={2}
            dot={{ r: 3, fill: p.series[0], stroke: p.surface, strokeWidth: 2 }}
            activeDot={{ r: 4.5, stroke: p.surface, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── weekly cash in/out bars ──────────────────────────────────────────────────

export function WeeklyCashChart({
  data,
  height = 210,
}: {
  data: { label: string; cashIn: number; cashOut: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <Legend
        items={[
          { label: "現金流入", color: p.series[0] },
          { label: "現金流出", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          <Bar name="現金流入" dataKey="cashIn" fill={p.series[0]} barSize={12} radius={[4, 4, 0, 0]} />
          <Bar name="現金流出" dataKey="cashOut" fill={p.series[1]} barSize={12} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── tagging hygiene trend ────────────────────────────────────────────────────

export function TaggingTrendChart({
  data,
  height = 200,
}: {
  data: { label: string; untaggedPct: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} minTickGap={24} />
        <YAxis tickFormatter={(v: number) => `${v}%`} tick={AXIS_FONT} tickLine={false} axisLine={false} width={44} />
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
        <Line name="未標示比例" dataKey="untaggedPct" stroke={p.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: p.surface, strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
