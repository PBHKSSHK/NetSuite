// Selector layer — every page reads through these functions. In production the
// same signatures are re-implemented against Supabase (fact_gl × report_group);
// pages stay untouched.

// 真數（Supabase hydration store — 引用不變，hydrate() 完成後 in-place 填數）
import { AP_OPEN, AR_OPEN, BANK_POINTS, BANK_TODAY, PL_FACTS } from "./store";
// 未有真數源嘅照舊由 demo 入（dept 分攤 / headcount / 客戶集中度 / recurring
// / tagging 係 Phase 2 真數）
import {
  CLIENT_REVENUE_SHARE,
  DEPT_WEIGHTS,
  GROUP_HEADCOUNT,
  RECURRING,
  taggingTrend,
  untaggedShare,
} from "./demo";
import { DEPARTMENTS, OPERATING_SUBS, PL_GROUPS, SUBSIDIARIES, UNTAGGED_DEPT_ID } from "./dims";
import { ACTUAL_MONTHS, CURRENT_FY, PRIOR_FY, TODAY } from "./fy";
import type { OpenItem } from "./types";

// ── generic fact summation ───────────────────────────────────────────────────

export function sumFacts(opts: {
  fy: string;
  kind: "actual" | "budget";
  subIds: number[];
  months: number[];
  groups?: string[];
}): number {
  const groupSet = opts.groups ? new Set(opts.groups) : null;
  const subSet = new Set(opts.subIds);
  const monthSet = new Set(opts.months);
  let total = 0;
  for (const f of PL_FACTS) {
    if (f.fyLabel !== opts.fy || f.kind !== opts.kind) continue;
    if (!subSet.has(f.subsidiaryId) || !monthSet.has(f.month)) continue;
    if (groupSet && !groupSet.has(f.groupCode)) continue;
    total += f.amount;
  }
  return total;
}

export const ALL_SUB_IDS = SUBSIDIARIES.map((s) => s.id);

/** resolve the subsidiary filter: -1 (consolidated) → all incl. Elimination */
export function resolveSubs(sel: number): number[] {
  return sel === -1 ? ALL_SUB_IDS : [sel];
}

// ── P&L table ────────────────────────────────────────────────────────────────

export interface PnLRow {
  code: string;
  label: string;
  kind: "group" | "subtotal" | "section";
  /** +1 income-natured, -1 expense-natured (drives favourable-variance colour) */
  sign: 1 | -1;
  actual: number;
  budget: number;
  ly: number;
}

const REV_CODES = ["REV_SERVICE", "REV_TRAVEL", "REV_GOODS"];
const COS_CODES = ["COS_SERVICES", "COS_GOODS"];
const OPEX_CODES = PL_GROUPS.filter((g) => g.section === "OPEX").map((g) => g.code);
const OTHER_CODES = ["OTHER_INCOME", "ASSOC_INCOME"];

function triple(subIds: number[], months: number[], groups: string[]) {
  return {
    actual: sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months, groups }),
    budget: sumFacts({ fy: CURRENT_FY, kind: "budget", subIds, months, groups }),
    ly: sumFacts({ fy: PRIOR_FY, kind: "actual", subIds, months, groups }),
  };
}

/** Pro-forma allocation (§5.5): Photoblog dept 6/9/11 cost re-charged to the
 *  other four subsidiaries pro-rata to their gross profit for the period. */
export function allocationForPeriod(months: number[], kind: "actual" | "budget" | "ly") {
  const fy = kind === "ly" ? PRIOR_FY : CURRENT_FY;
  const factKind = kind === "ly" ? "actual" : kind;
  const pbWeights = DEPT_WEIGHTS[1];
  const allocShare = pbWeights[6] + pbWeights[9] + pbWeights[11]; // dept share of PB cost base
  const pbOpex = sumFacts({ fy, kind: factKind, subIds: [1], months, groups: OPEX_CODES });
  const pool = pbOpex * allocShare;
  const targets = [2, 5, 7, 8];
  const gps = targets.map((s) => {
    const rev = sumFacts({ fy, kind: factKind, subIds: [s], months, groups: REV_CODES });
    const cos = sumFacts({ fy, kind: factKind, subIds: [s], months, groups: COS_CODES });
    return Math.max(0, rev - cos);
  });
  const gpTotal = gps.reduce((a, b) => a + b, 0) || 1;
  const bySub: Record<number, number> = { 1: -pool };
  targets.forEach((s, i) => (bySub[s] = pool * (gps[i] / gpTotal)));
  return { pool, bySub, gpShares: targets.map((s, i) => ({ sub: s, share: gps[i] / gpTotal })) };
}

export function pnlRows(subSel: number, months: number[], allocated: boolean): PnLRow[] {
  const subIds = resolveSubs(subSel);
  const rows: PnLRow[] = [];
  const push = (code: string, label: string, kind: PnLRow["kind"], sign: 1 | -1, groups: string[]) => {
    const t = triple(subIds, months, groups);
    rows.push({ code, label, kind, sign, ...t });
  };

  for (const g of PL_GROUPS.filter((x) => x.section === "REVENUE")) push(g.code, g.labelZh, "group", 1, [g.code]);
  push("TOTAL_REV", "總收入", "subtotal", 1, REV_CODES);
  for (const g of PL_GROUPS.filter((x) => x.section === "COS")) push(g.code, g.labelZh, "group", -1, [g.code]);

  const gp = {
    actual: triple(subIds, months, REV_CODES).actual - triple(subIds, months, COS_CODES).actual,
    budget: triple(subIds, months, REV_CODES).budget - triple(subIds, months, COS_CODES).budget,
    ly: triple(subIds, months, REV_CODES).ly - triple(subIds, months, COS_CODES).ly,
  };
  rows.push({ code: "GP", label: "毛利 Gross Profit", kind: "subtotal", sign: 1, ...gp });

  const agi = {
    actual:
      triple(subIds, months, ["REV_SERVICE", "REV_TRAVEL"]).actual - triple(subIds, months, ["COS_SERVICES"]).actual,
    budget:
      triple(subIds, months, ["REV_SERVICE", "REV_TRAVEL"]).budget - triple(subIds, months, ["COS_SERVICES"]).budget,
    ly: triple(subIds, months, ["REV_SERVICE", "REV_TRAVEL"]).ly - triple(subIds, months, ["COS_SERVICES"]).ly,
  };
  rows.push({ code: "AGI", label: "AGI（服務+旅遊收入 − 服務成本）", kind: "subtotal", sign: 1, ...agi });

  for (const g of PL_GROUPS.filter((x) => x.section === "OPEX")) push(g.code, g.labelZh, "group", -1, [g.code]);

  // pro-forma allocation line (only meaningful for single-sub view; nets to 0 consolidated)
  let allocRow: PnLRow | null = null;
  if (allocated && subSel !== -1 && subSel !== 4) {
    allocRow = {
      code: "ALLOC",
      label: "集團費用分攤（pro-forma）",
      kind: "group",
      sign: -1,
      actual: allocationForPeriod(months, "actual").bySub[subSel] ?? 0,
      budget: allocationForPeriod(months, "budget").bySub[subSel] ?? 0,
      ly: allocationForPeriod(months, "ly").bySub[subSel] ?? 0,
    };
    rows.push(allocRow);
  }

  const opex = triple(subIds, months, OPEX_CODES);
  const dep = triple(subIds, months, ["OPEX_DEPRECIATION"]);
  const allocAdj = allocRow ? { actual: allocRow.actual, budget: allocRow.budget, ly: allocRow.ly } : { actual: 0, budget: 0, ly: 0 };

  rows.push({
    code: "EBITDA",
    label: "EBITDA",
    kind: "subtotal",
    sign: 1,
    actual: gp.actual - opex.actual - allocAdj.actual + dep.actual,
    budget: gp.budget - opex.budget - allocAdj.budget + dep.budget,
    ly: gp.ly - opex.ly - allocAdj.ly + dep.ly,
  });

  for (const g of PL_GROUPS.filter((x) => x.section === "OTHER_INCOME")) push(g.code, g.labelZh, "group", 1, [g.code]);

  const other = triple(subIds, months, OTHER_CODES);
  rows.push({
    code: "NP",
    label: "純利 Net Profit",
    kind: "subtotal",
    sign: 1,
    actual: gp.actual - opex.actual - allocAdj.actual + other.actual,
    budget: gp.budget - opex.budget - allocAdj.budget + other.budget,
    ly: gp.ly - opex.ly - allocAdj.ly + other.ly,
  });
  return rows;
}

/** 12-month trend for a metric (NP / REV / AGI / GP) across the current FY. */
export function pnlTrend(subSel: number, metric: "REV" | "GP" | "AGI" | "NP") {
  const subIds = resolveSubs(subSel);
  const out: { month: number; actual: number | null; budget: number; ly: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const calc = (fy: string, kind: "actual" | "budget"): number => {
      const rev = sumFacts({ fy, kind, subIds, months: [m], groups: REV_CODES });
      const cos = sumFacts({ fy, kind, subIds, months: [m], groups: COS_CODES });
      const opex = sumFacts({ fy, kind, subIds, months: [m], groups: OPEX_CODES });
      const other = sumFacts({ fy, kind, subIds, months: [m], groups: OTHER_CODES });
      const svc = sumFacts({ fy, kind, subIds, months: [m], groups: ["REV_SERVICE", "REV_TRAVEL"] });
      const cosS = sumFacts({ fy, kind, subIds, months: [m], groups: ["COS_SERVICES"] });
      switch (metric) {
        case "REV": return rev;
        case "GP": return rev - cos;
        case "AGI": return svc - cosS;
        case "NP": return rev - cos - opex + other;
      }
    };
    out.push({
      month: m,
      actual: m <= ACTUAL_MONTHS ? calc(CURRENT_FY, "actual") : null,
      budget: calc(CURRENT_FY, "budget"),
      ly: calc(PRIOR_FY, "actual"),
    });
  }
  return out;
}

// ── Balance sheet ────────────────────────────────────────────────────────────

const BS_CONST: Record<number, { otherCa: number; faBase: number; invAssoc: number; tax: number; shareCap: number }> = {
  1: { otherCa: 400_000, faBase: 1_900_000, invAssoc: 2_800_000, tax: 260_000, shareCap: 1_000_000 },
  2: { otherCa: 550_000, faBase: 1_100_000, invAssoc: 0, tax: 420_000, shareCap: 100_000 },
  5: { otherCa: 250_000, faBase: 1_600_000, invAssoc: 0, tax: 90_000, shareCap: 10_000 },
  7: { otherCa: 380_000, faBase: 900_000, invAssoc: 0, tax: 120_000, shareCap: 100_000 },
  8: { otherCa: 180_000, faBase: 2_300_000, invAssoc: 0, tax: 0, shareCap: 10_000 },
  4: { otherCa: 0, faBase: 0, invAssoc: 0, tax: 0, shareCap: 0 },
};

export interface BSRow {
  code: string;
  label: string;
  section: string;
  amount: number;
}

export function balanceSheet(subSel: number, asOfMonth: number): { rows: BSRow[]; totals: Record<string, number> } {
  const subIds = resolveSubs(subSel).filter((id) => id !== 4);
  const val = (fn: (sub: number) => number) => Math.round(subIds.reduce((a, s) => a + fn(s), 0));

  const monthScale = 0.88 + asOfMonth * 0.03;
  const cash = val((s) => (asOfMonth === ACTUAL_MONTHS ? BANK_TODAY[s] : BANK_TODAY[s] * monthScale));
  const ar = val((s) =>
    asOfMonth === ACTUAL_MONTHS
      ? AR_OPEN.filter((i) => i.subsidiaryId === s).reduce((a, i) => a + i.amountOpen, 0)
      : AR_OPEN.filter((i) => i.subsidiaryId === s).reduce((a, i) => a + i.amountOpen, 0) * monthScale
  );
  const ap = val((s) =>
    asOfMonth === ACTUAL_MONTHS
      ? AP_OPEN.filter((i) => i.subsidiaryId === s).reduce((a, i) => a + i.amountOpen, 0)
      : AP_OPEN.filter((i) => i.subsidiaryId === s).reduce((a, i) => a + i.amountOpen, 0) * monthScale
  );
  const otherCa = val((s) => BS_CONST[s].otherCa);
  const monthlyDep = val((s) => sumFacts({ fy: CURRENT_FY, kind: "budget", subIds: [s], months: [1], groups: ["OPEX_DEPRECIATION"] }));
  const fa = val((s) => BS_CONST[s].faBase) - monthlyDep * asOfMonth;
  const invAssoc = val((s) => BS_CONST[s].invAssoc);
  const accruals = val((s) => sumFacts({ fy: CURRENT_FY, kind: "budget", subIds: [s], months: [1], groups: ["OPEX_STAFF"] }));
  const tax = val((s) => BS_CONST[s].tax);
  const shareCap = val((s) => BS_CONST[s].shareCap);

  const totalAssets = cash + ar + otherCa + fa + invAssoc;
  const totalLiab = ap + accruals + tax;
  const retained = totalAssets - totalLiab - shareCap;

  const rows: BSRow[] = [
    { code: "BS_CASH", label: "銀行及現金", section: "CURRENT_ASSETS", amount: cash },
    { code: "BS_AR", label: "應收帳款", section: "CURRENT_ASSETS", amount: ar },
    { code: "BS_OTHER_CA", label: "按金及預付款", section: "CURRENT_ASSETS", amount: otherCa },
    { code: "BS_FA", label: "固定資產（淨值）", section: "NON_CURRENT_ASSETS", amount: fa },
    { code: "BS_INV_ASSOC", label: "聯營公司投資", section: "NON_CURRENT_ASSETS", amount: invAssoc },
    { code: "BS_AP", label: "應付帳款", section: "CURRENT_LIABILITIES", amount: ap },
    { code: "BS_ACCRUALS", label: "應計及其他應付款", section: "CURRENT_LIABILITIES", amount: accruals },
    { code: "BS_TAX", label: "應付稅項", section: "CURRENT_LIABILITIES", amount: tax },
    { code: "BS_SHARE_CAP", label: "股本", section: "EQUITY", amount: shareCap },
    { code: "BS_RETAINED", label: "保留盈利（含本年）", section: "EQUITY", amount: retained },
  ];
  return {
    rows,
    totals: {
      assets: totalAssets,
      liabilities: totalLiab,
      equity: shareCap + retained,
      netAssets: totalAssets - totalLiab,
    },
  };
}

// ── A/R & A/P aging ──────────────────────────────────────────────────────────

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90p: number;
  total: number;
}

export function ageBuckets(items: OpenItem[]): AgingBuckets {
  const b: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, total: 0 };
  for (const i of items) {
    const overdue = Math.floor((TODAY.getTime() - new Date(i.dueDate).getTime()) / 86_400_000);
    if (overdue <= 0) b.current += i.amountOpen;
    else if (overdue <= 30) b.d1_30 += i.amountOpen;
    else if (overdue <= 60) b.d31_60 += i.amountOpen;
    else if (overdue <= 90) b.d61_90 += i.amountOpen;
    else b.d90p += i.amountOpen;
    b.total += i.amountOpen;
  }
  return b;
}

export function arItems(subSel: number): OpenItem[] {
  const subs = new Set(resolveSubs(subSel));
  return AR_OPEN.filter((i) => subs.has(i.subsidiaryId));
}

export function apItems(subSel: number): OpenItem[] {
  const subs = new Set(resolveSubs(subSel));
  return AP_OPEN.filter((i) => subs.has(i.subsidiaryId));
}

export function dso(subSel: number): number {
  const subIds = resolveSubs(subSel);
  const rev = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [2, 3, 4], groups: REV_CODES });
  const ar = arItems(subSel).reduce((a, i) => a + i.amountOpen, 0);
  return Math.round(ar / (rev / 91));
}

export function dpo(subSel: number): number {
  const subIds = resolveSubs(subSel);
  const cos = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [2, 3, 4], groups: COS_CODES });
  const ap = apItems(subSel).reduce((a, i) => a + i.amountOpen, 0);
  return Math.round(ap / (cos / 91));
}

// ── bank ─────────────────────────────────────────────────────────────────────

export function bankTrend(): { date: string; total: number; bySub: Record<number, number> }[] {
  const byDate = new Map<string, Record<number, number>>();
  for (const p of BANK_POINTS) {
    const rec = byDate.get(p.date) ?? {};
    rec[p.subsidiaryId] = p.balance;
    byDate.set(p.date, rec);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, bySub]) => ({
      date,
      total: Object.values(bySub).reduce((a, b) => a + b, 0),
      bySub,
    }));
}

export function groupBankTotal(): number {
  return Object.values(BANK_TODAY).reduce((a, b) => a + b, 0);
}

// ── cost center ──────────────────────────────────────────────────────────────

export interface CostCenterCell {
  deptId: number;
  deptLabel: string;
  amount: number;
}

export function costCenterMatrix(subId: number, months: number[]): {
  columns: { deptId: number; label: string }[];
  rows: { code: string; label: string; cells: number[]; total: number }[];
  untaggedTotal: number;
  taggedTotal: number;
} {
  const weights = DEPT_WEIGHTS[subId] ?? {};
  const deptIds = Object.keys(weights).map(Number);
  const wSum = deptIds.reduce((a, d) => a + weights[d], 0) || 1;
  const avgUntagged =
    months.reduce((a, m) => a + untaggedShare(m), 0) / Math.max(1, months.length);

  const costGroups = PL_GROUPS.filter((g) => g.section === "COS" || g.section === "OPEX");
  const columns = [
    ...deptIds.map((d) => ({
      deptId: d,
      label: DEPARTMENTS.find((x) => x.id === d)?.nameZh ?? String(d),
    })),
    { deptId: UNTAGGED_DEPT_ID, label: "未標示 Untagged" },
  ];

  let untaggedTotal = 0;
  let taggedTotal = 0;
  const rows = costGroups.map((g) => {
    const total = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [subId], months, groups: [g.code] });
    // staff cost is fully tagged (payroll import carries dept); other lines follow audit coverage
    const untaggedFrac = g.code === "OPEX_STAFF" || g.code === "OPEX_DEPRECIATION" ? 0.02 : avgUntagged;
    const untagged = total * untaggedFrac;
    const tagged = total - untagged;
    untaggedTotal += untagged;
    taggedTotal += tagged;
    const cells = deptIds.map((d) => Math.round(tagged * (weights[d] / wSum)));
    cells.push(Math.round(untagged));
    return { code: g.code, label: g.labelZh, cells, total: Math.round(total) };
  });

  return { columns, rows, untaggedTotal: Math.round(untaggedTotal), taggedTotal: Math.round(taggedTotal) };
}

export { taggingTrend };

// ── cashflow ─────────────────────────────────────────────────────────────────

export interface MonthlyCashRow {
  month: number;
  receipts: number;
  suppliers: number;
  payroll: number;
  rentAndRecurring: number;
  other: number;
  net: number;
  opening: number;
  closing: number;
}

export function cashflowMonthly(subSel: number): MonthlyCashRow[] {
  const subIds = resolveSubs(subSel).filter((s) => s !== 4);
  const recurringOut = RECURRING.filter(
    (r) => r.direction === "out" && (subSel === -1 || r.subsidiaryId === subSel)
  ).reduce((a, r) => a + r.amount, 0);

  const rows: Omit<MonthlyCashRow, "opening" | "closing">[] = [];
  for (let m = 1; m <= ACTUAL_MONTHS; m++) {
    const prevM = Math.max(1, m - 1);
    const receipts = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [prevM], groups: REV_CODES }) * 0.99;
    const suppliers = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [prevM], groups: COS_CODES }) * 1.01;
    const payroll = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [m], groups: ["OPEX_STAFF"] });
    const other =
      sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months: [m], groups: ["OPEX_ADMIN", "OPEX_IT", "OPEX_MARKETING", "OPEX_OTHER"] });
    const net = receipts - suppliers - payroll - recurringOut - other;
    rows.push({
      month: m,
      receipts: Math.round(receipts),
      suppliers: Math.round(suppliers),
      payroll: Math.round(payroll),
      rentAndRecurring: Math.round(recurringOut),
      other: Math.round(other),
      net: Math.round(net),
    });
  }
  // anchor: closing of latest closed month = bank balance today (same source as widget)
  const bankNow = subIds.reduce((a, s) => a + (BANK_TODAY[s] ?? 0), 0);
  const netSum = rows.reduce((a, r) => a + r.net, 0);
  let opening = bankNow - netSum;
  return rows.map((r) => {
    const withBal = { ...r, opening: Math.round(opening), closing: Math.round(opening + r.net) };
    opening += r.net;
    return withBal;
  });
}

// ── 13-week rolling forecast (§5.4 tab 3) ────────────────────────────────────

export interface ForecastWeek {
  weekStart: string;
  arCollections: number;
  assumedNewCollections: number;
  recurringIn: number;
  apPayments: number;
  payroll: number;
  recurringOut: number;
  otherOpex: number;
  net: number;
  closing: number;
  belowFloor: boolean;
}

export const COLLECTION_LAG_DAYS = 14;

export function forecast13w(lagDays: number = COLLECTION_LAG_DAYS): { weeks: ForecastWeek[]; floor: number } {
  const floor = OPERATING_SUBS.reduce((a, s) => a + s.cashFloor, 0);
  const monday = new Date(TODAY.getTime() - ((TODAY.getUTCDay() + 6) % 7) * 86_400_000);
  const monthlyPayroll = sumFacts({ fy: CURRENT_FY, kind: "budget", subIds: ALL_SUB_IDS, months: [5], groups: ["OPEX_STAFF"] });
  const monthlyOtherOpex = sumFacts({
    fy: CURRENT_FY, kind: "budget", subIds: ALL_SUB_IDS, months: [5],
    groups: ["OPEX_ADMIN", "OPEX_IT", "OPEX_MARKETING", "OPEX_OTHER"],
  });
  const monthlyExpectedRev = sumFacts({ fy: CURRENT_FY, kind: "budget", subIds: ALL_SUB_IDS, months: [6], groups: REV_CODES });

  let closing = groupBankTotal();
  const weeks: ForecastWeek[] = [];
  for (let w = 0; w < 13; w++) {
    const start = new Date(monday.getTime() + w * 7 * 86_400_000);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const inWeek = (d: Date) => d >= start && d < end;

    const arCollections = AR_OPEN.filter((i) =>
      inWeek(new Date(new Date(i.dueDate).getTime() + lagDays * 86_400_000))
    ).reduce((a, i) => a + i.amountOpen, 0);
    const apPayments = AP_OPEN.filter((i) => inWeek(new Date(i.dueDate))).reduce((a, i) => a + i.amountOpen, 0);

    let recurringIn = 0;
    let recurringOut = 0;
    for (const r of RECURRING) {
      // fire on the matching day-of-month inside this week
      for (let dd = 0; dd < 7; dd++) {
        const day = new Date(start.getTime() + dd * 86_400_000);
        if (day.getUTCDate() === r.dayOfMonth) {
          if (r.direction === "in") recurringIn += r.amount;
          else recurringOut += r.amount;
        }
      }
    }

    let payroll = 0;
    for (let dd = 0; dd < 7; dd++) {
      const day = new Date(start.getTime() + dd * 86_400_000);
      if (day.getUTCDate() === 28) payroll = monthlyPayroll;
    }

    // beyond the open-AR horizon, assume budgeted billings collect on the same lag
    const assumedNewCollections = w >= 6 ? Math.round((monthlyExpectedRev * 0.95) / 4.33) : 0;
    const otherOpex = Math.round(monthlyOtherOpex / 4.33);

    const net = arCollections + assumedNewCollections + recurringIn - apPayments - payroll - recurringOut - otherOpex;
    closing += net;
    weeks.push({
      weekStart: start.toISOString().slice(0, 10),
      arCollections: Math.round(arCollections),
      assumedNewCollections,
      recurringIn,
      apPayments: Math.round(apPayments),
      payroll: Math.round(payroll),
      recurringOut,
      otherOpex,
      net: Math.round(net),
      closing: Math.round(closing),
      belowFloor: closing < floor,
    });
  }
  return { weeks, floor };
}

// ── KPIs (§6.2) ──────────────────────────────────────────────────────────────

export function kpiAgi(subSel: number, months: number[]) {
  const subIds = resolveSubs(subSel);
  const svc = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months, groups: ["REV_SERVICE", "REV_TRAVEL"] });
  const cosS = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months, groups: ["COS_SERVICES"] });
  const agi = svc - cosS;
  const staff = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months, groups: ["OPEX_STAFF"] });
  const rev = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds, months, groups: REV_CODES });
  return {
    agi,
    agiMargin: svc ? agi / svc : 0,
    staffToAgi: agi ? staff / agi : 0,
    revenue: rev,
    revenuePerHeadAnnualised: (rev / months.length) * 12 / GROUP_HEADCOUNT,
  };
}

export function concentration() {
  const top5 = CLIENT_REVENUE_SHARE.slice(0, 5).reduce((a, c) => a + c.share, 0);
  const top10 = CLIENT_REVENUE_SHARE.slice(0, 10).reduce((a, c) => a + c.share, 0);
  return { top5, top10, list: CLIENT_REVENUE_SHARE };
}

// ── alerts (§7 rules evaluated on demo data) ─────────────────────────────────

export interface Alert {
  severity: "critical" | "serious" | "warning" | "good";
  title: string;
  detail: string;
  rule: string;
}

export function alerts(): Alert[] {
  const out: Alert[] = [];

  // cash below floor
  for (const s of OPERATING_SUBS) {
    const bal = BANK_TODAY[s.id] ?? 0;
    if (bal < s.cashFloor) {
      out.push({
        severity: "critical",
        title: `${s.short} 現金低於警戒線`,
        detail: `結餘 HK$${(bal / 1_000_000).toFixed(2)}M < 警戒線 HK$${(s.cashFloor / 1_000_000).toFixed(2)}M`,
        rule: "bank balance < floor",
      });
    }
  }

  // AR overdue > 60d and > 50k, grouped by client
  const byClient = new Map<string, number>();
  for (const i of AR_OPEN) {
    const overdue = Math.floor((TODAY.getTime() - new Date(i.dueDate).getTime()) / 86_400_000);
    if (overdue > 60) byClient.set(i.entityName, (byClient.get(i.entityName) ?? 0) + i.amountOpen);
  }
  const flagged = [...byClient.entries()]
    .filter(([, amt]) => amt > 50_000)
    .sort(([, a], [, b]) => b - a);
  for (const [client, amt] of flagged.slice(0, 4)) {
    out.push({
      severity: "serious",
      title: `應收嚴重逾期 — ${client}`,
      detail: `逾期 > 60 日金額 HK$${Math.round(amt / 1000).toLocaleString()}K`,
      rule: "A/R overdue > 60d & > HK$50K",
    });
  }
  if (flagged.length > 4) {
    const rest = flagged.slice(4).reduce((a, [, amt]) => a + amt, 0);
    out.push({
      severity: "serious",
      title: `另有 ${flagged.length - 4} 個客戶觸發應收逾期警示`,
      detail: `合計逾期 > 60 日金額 HK$${Math.round(rest / 1000).toLocaleString()}K — 明細見 Cashflow → Aging`,
      rule: "A/R overdue > 60d & > HK$50K",
    });
  }

  // tagging deterioration
  const tg = taggingTrend();
  const last = tg[tg.length - 1];
  const prev = tg[tg.length - 2];
  if (last.untaggedLines > prev.untaggedLines * 1.2) {
    out.push({
      severity: "warning",
      title: "Tagging 走樣",
      detail: `本月未標示 department 行數 ${last.untaggedLines} > 上月 120%（${prev.untaggedLines}）`,
      rule: "untagged lines > 120% of last month",
    });
  }

  out.push({
    severity: "good",
    title: "Sync 正常",
    detail: "示範模式 — production 會讀 sync_log（連續 2 次失敗即警示）",
    rule: "sync_log status",
  });
  return out;
}

export { REV_CODES, COS_CODES, OPEX_CODES };
