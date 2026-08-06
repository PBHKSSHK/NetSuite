// Fiscal year helpers. FY runs April → March (FY month 1 = April).
// FY2026/27 = 2026-04 … 2027-03.

export const CURRENT_FY = "FY2026/27";
export const PRIOR_FY = "FY2025/26";
export const CURRENT_FY_START_YEAR = 2026;

/** Demo clock: "today" for the demo dataset. */
export const TODAY = new Date(Date.UTC(2026, 7, 6)); // 2026-08-06

/** Number of closed / actual FY months in the current FY (Apr–Jul 2026). */
export const ACTUAL_MONTHS = 4;

/** Calendar (year, month 1–12) for an FY month of a FY starting in startYear. */
export function fyMonthToCalendar(
  fyMonth: number,
  startYear: number = CURRENT_FY_START_YEAR
): { year: number; month: number } {
  const m0 = 3 + (fyMonth - 1); // April = index 3
  return { year: startYear + Math.floor(m0 / 12), month: (m0 % 12) + 1 };
}

const ZH_MONTHS = [
  "4月", "5月", "6月", "7月", "8月", "9月",
  "10月", "11月", "12月", "1月", "2月", "3月",
];

export function fyMonthLabel(fyMonth: number): string {
  return ZH_MONTHS[fyMonth - 1];
}

export function fyMonthFull(fyMonth: number, startYear = CURRENT_FY_START_YEAR): string {
  const { year, month } = fyMonthToCalendar(fyMonth, startYear);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** End-of-month ISO date for an FY month. */
export function fyMonthEnd(fyMonth: number, startYear = CURRENT_FY_START_YEAR): string {
  const { year, month } = fyMonthToCalendar(fyMonth, startYear);
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

/** FY months included by a period selection. */
export function monthsInPeriod(mode: "month" | "quarter" | "ytd", month: number): number[] {
  if (mode === "month") return [month];
  if (mode === "quarter") {
    const q = Math.floor((month - 1) / 3);
    return [q * 3 + 1, q * 3 + 2, q * 3 + 3].filter((m) => m <= month);
  }
  return Array.from({ length: month }, (_, i) => i + 1);
}

export function periodLabel(mode: "month" | "quarter" | "ytd", month: number): string {
  if (mode === "month") return fyMonthFull(month);
  if (mode === "quarter") return `Q${Math.floor((month - 1) / 3) + 1}（財年）`;
  return `YTD（4月–${fyMonthLabel(month)}）`;
}
