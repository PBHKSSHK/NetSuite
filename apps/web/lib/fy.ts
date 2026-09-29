// Fiscal year helpers. FY runs April → March (FY month 1 = April).
// FY2026/27 = 2026-04 … 2027-03.

/** 香港日期（UTC+8）截到當日 00:00 UTC，server / client 同一日內一致。 */
function hkToday(): Date {
  const hk = new Date(Date.now() + 8 * 3_600_000);
  return new Date(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate()));
}

/** 真實時鐘：所有「截至今日」/ 逾期日數 / 本週範圍都由呢度出。 */
export const TODAY = hkToday();

const TODAY_YEAR = TODAY.getUTCFullYear();
const TODAY_MONTH = TODAY.getUTCMonth() + 1; // 1–12

function fyLabelOf(startYear: number): string {
  return `FY${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** 現行財年起始年（4 月起計：2026-04 → 2027-03 = FY2026/27）。 */
export const CURRENT_FY_START_YEAR = TODAY_MONTH >= 4 ? TODAY_YEAR : TODAY_YEAR - 1;
export const CURRENT_FY = fyLabelOf(CURRENT_FY_START_YEAR);
export const PRIOR_FY = fyLabelOf(CURRENT_FY_START_YEAR - 1);

/**
 * 現行財年內有實際數嘅 FY 月份數，**包含當前進行中嘅月份**（每晚 sync 會補上
 * 當月入帳），所以所有報表預設 YTD 都睇到 current month。
 */
export const ACTUAL_MONTHS = ((TODAY_MONTH - 4 + 12) % 12) + 1;

/** 已完整過去嘅月份數（年化 / 平均用，避免被進行中嘅月份拉低）。 */
export const CLOSED_MONTHS = Math.max(1, ACTUAL_MONTHS - 1);

/** 年化時用嘅月數：剔除進行中嘅當月；只揀咗當月則照用。 */
export function annualisationMonths(months: number[]): number {
  const full = months.filter((m) => m < ACTUAL_MONTHS).length;
  return full > 0 ? full : months.length;
}

/** 係咪進行中嘅當月（數字未完整）。 */
export function isCurrentMonth(fyMonth: number): boolean {
  return fyMonth === ACTUAL_MONTHS;
}

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
  const live = isCurrentMonth(month) ? "，本月進行中" : "";
  if (mode === "month") return `${fyMonthFull(month)}${live ? "（本月進行中）" : ""}`;
  if (mode === "quarter") return `Q${Math.floor((month - 1) / 3) + 1}（財年${live}）`;
  return `YTD（4月–${fyMonthLabel(month)}${live}）`;
}

/** 頁面副題用：「FY2026/27 YTD（4–9 月，本月進行中）」 */
export function ytdHeading(): string {
  const live = ACTUAL_MONTHS > 1 ? "，本月進行中" : "（本月進行中）";
  return ACTUAL_MONTHS > 1
    ? `${CURRENT_FY} YTD（4–${fyMonthLabel(ACTUAL_MONTHS).replace("月", "")} 月${live}）`
    : `${CURRENT_FY} YTD${live}`;
}
