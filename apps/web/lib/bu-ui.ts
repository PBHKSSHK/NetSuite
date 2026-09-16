// BU 頁面共用小工具：公司名（含 dims 冇嘅 sub 3 / 6）、期間對上年、traffic light。

import { subsidiaryById } from "./dims";
import type { Period } from "./bu";
import { availableFys, priorFy } from "./bu";

const EXTRA_SUBS: Record<number, string> = { 3: "CLS Production", 6: "Go Asia" };

export function subName(id: number): string {
  return subsidiaryById(id)?.short ?? EXTRA_SUBS[id] ?? `Sub #${id}`;
}

/** 同一組 FY 月份對上一年；上年冇數據時回 null */
export function lyPeriod(p: Period): Period | null {
  const ly = priorFy(p.fy);
  return availableFys().includes(ly) ? { fy: ly, months: p.months } : null;
}

export function delta(cur: number, base: number | null | undefined): number | null {
  if (base == null || !base) return null;
  return (cur - base) / Math.abs(base);
}

/** 紅綠燈：vs 比較基準 ±10%（§5.1；未有 budget 前先用去年同期） */
export function light(d: number | null): "good" | "warn" | "bad" | "na" {
  if (d == null) return "na";
  if (d >= -0.1) return d >= 0.1 ? "good" : "warn";
  return "bad";
}
