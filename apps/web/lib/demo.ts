// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATASET (deterministic, seeded — same numbers every build).
// Structure mirrors the production Supabase schema; numbers are FICTIONAL and
// exist only so the dashboard can be reviewed end-to-end before the real
// NetSuite sync is wired up. Every page shows a DEMO banner while this module
// is the active data source.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BankPoint,
  MonthlyFact,
  OpenItem,
  PayrollRow,
  RecurringCashItem,
} from "./types";
import { ACTUAL_MONTHS, CURRENT_FY, PRIOR_FY, TODAY, fyMonthToCalendar } from "./fy";

// ── deterministic PRNG ────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** deterministic uniform in [0,1) keyed by a string */
function rand(key: string): number {
  let t = (hashStr(key) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** jitter multiplier: 1 ± amp */
function jit(key: string, amp: number): number {
  return 1 + (rand(key) * 2 - 1) * amp;
}

// ── P&L model parameters (annual HKD, current-FY budget) ─────────────────────

interface SubModel {
  revService: number;
  revTravel: number;
  revGoods: number;
  cosServiceRatio: number; // of service revenue
  cosTravelRatio: number; // of travel revenue
  cosGoodsRatio: number; // of goods revenue
  opex: Record<string, number>;
  otherIncome: number;
  /** associates dividend/gain, lump in FY months 3 & 9 */
  assocIncome: number;
  /** actual vs budget performance factor */
  perf: number;
  /** YoY growth (current budget vs prior actual) */
  growth: number;
}

const MODELS: Record<number, SubModel> = {
  1: {
    revService: 16_800_000, revTravel: 0, revGoods: 720_000,
    cosServiceRatio: 0.33, cosTravelRatio: 0, cosGoodsRatio: 0.65,
    opex: { OPEX_STAFF: 6_600_000, OPEX_RENT: 1_440_000, OPEX_DEPRECIATION: 420_000, OPEX_ADMIN: 900_000, OPEX_IT: 660_000, OPEX_MARKETING: 360_000, OPEX_OTHER: 480_000 },
    otherIncome: 180_000, assocIncome: 1_200_000, perf: 1.03, growth: 1.06,
  },
  2: {
    revService: 31_200_000, revTravel: 0, revGoods: 0,
    cosServiceRatio: 0.46, cosTravelRatio: 0, cosGoodsRatio: 0,
    opex: { OPEX_STAFF: 10_200_000, OPEX_RENT: 1_680_000, OPEX_DEPRECIATION: 300_000, OPEX_ADMIN: 840_000, OPEX_IT: 600_000, OPEX_MARKETING: 480_000, OPEX_OTHER: 540_000 },
    otherIncome: 120_000, assocIncome: 0, perf: 0.94, growth: 1.12,
  },
  5: {
    revService: 7_800_000, revTravel: 0, revGoods: 2_640_000,
    cosServiceRatio: 0.30, cosTravelRatio: 0, cosGoodsRatio: 0.62,
    opex: { OPEX_STAFF: 3_120_000, OPEX_RENT: 960_000, OPEX_DEPRECIATION: 360_000, OPEX_ADMIN: 420_000, OPEX_IT: 180_000, OPEX_MARKETING: 300_000, OPEX_OTHER: 300_000 },
    otherIncome: 60_000, assocIncome: 0, perf: 1.08, growth: 1.15,
  },
  7: {
    revService: 13_200_000, revTravel: 5_400_000, revGoods: 0,
    cosServiceRatio: 0.36, cosTravelRatio: 0.82, cosGoodsRatio: 0,
    opex: { OPEX_STAFF: 5_520_000, OPEX_RENT: 1_200_000, OPEX_DEPRECIATION: 240_000, OPEX_ADMIN: 600_000, OPEX_IT: 360_000, OPEX_MARKETING: 420_000, OPEX_OTHER: 420_000 },
    otherIncome: 90_000, assocIncome: 0, perf: 0.97, growth: 1.04,
  },
  8: {
    revService: 9_000_000, revTravel: 0, revGoods: 0,
    cosServiceRatio: 0.34, cosTravelRatio: 0, cosGoodsRatio: 0,
    opex: { OPEX_STAFF: 3_480_000, OPEX_RENT: 840_000, OPEX_DEPRECIATION: 540_000, OPEX_ADMIN: 360_000, OPEX_IT: 240_000, OPEX_MARKETING: 180_000, OPEX_OTHER: 300_000 },
    otherIncome: 60_000, assocIncome: 0, perf: 1.05, growth: 1.1,
  },
  // Elimination: intercompany service fees net out at GP level
  4: {
    revService: -2_400_000, revTravel: 0, revGoods: 0,
    cosServiceRatio: 1, cosTravelRatio: 0, cosGoodsRatio: 0,
    opex: { OPEX_STAFF: 0, OPEX_RENT: 0, OPEX_DEPRECIATION: 0, OPEX_ADMIN: 0, OPEX_IT: 0, OPEX_MARKETING: 0, OPEX_OTHER: 0 },
    otherIncome: 0, assocIncome: 0, perf: 1, growth: 1.08,
  },
};

/** revenue seasonality, FY months Apr…Mar (sums to 12) */
const SEASON = [0.85, 0.9, 0.95, 1.0, 0.95, 1.05, 1.15, 1.2, 1.25, 0.8, 0.75, 1.15];

// ── fact builder ─────────────────────────────────────────────────────────────

function pushFacts(
  out: MonthlyFact[],
  fyLabel: string,
  subsidiaryId: number,
  month: number,
  kind: "actual" | "budget",
  scale: number, // 1 for current budget; perf/growth-adjusted otherwise
  jitterAmp: number
) {
  const m = MODELS[subsidiaryId];
  const season = SEASON[month - 1];
  const k = `${fyLabel}|${subsidiaryId}|${month}|${kind}`;

  const revS = (m.revService / 12) * season * scale * (jitterAmp ? jit(k + "rs", jitterAmp) : 1);
  const revT = (m.revTravel / 12) * season * scale * (jitterAmp ? jit(k + "rt", jitterAmp) : 1);
  const revG = (m.revGoods / 12) * season * scale * (jitterAmp ? jit(k + "rg", jitterAmp) : 1);
  const cosS = revS * m.cosServiceRatio * (jitterAmp ? jit(k + "cs", 0.03) : 1) + revT * m.cosTravelRatio;
  const cosG = revG * m.cosGoodsRatio;

  const rows: [string, number][] = [
    ["REV_SERVICE", revS],
    ["REV_TRAVEL", revT],
    ["REV_GOODS", revG],
    ["COS_SERVICES", cosS],
    ["COS_GOODS", cosG],
  ];
  for (const [code, annual] of Object.entries(m.opex)) {
    const opexJit = jitterAmp && code !== "OPEX_STAFF" && code !== "OPEX_RENT" && code !== "OPEX_DEPRECIATION" ? jit(k + code, 0.06) : 1;
    rows.push([code, (annual / 12) * (kind === "actual" ? opexJit : 1) * (fyLabel === PRIOR_FY ? 1 / m.growth : 1)]);
  }
  rows.push(["OTHER_INCOME", (m.otherIncome / 12) * (fyLabel === PRIOR_FY ? 1 / m.growth : 1)]);
  const assocBase = fyLabel === PRIOR_FY ? m.assocIncome * 0.85 : m.assocIncome;
  rows.push(["ASSOC_INCOME", month === 3 || month === 9 ? assocBase / 2 : 0]);

  for (const [groupCode, amount] of rows) {
    if (amount === 0) continue;
    out.push({ fyLabel, subsidiaryId, groupCode, month, kind, amount: Math.round(amount) });
  }
}

function buildFacts(): MonthlyFact[] {
  const out: MonthlyFact[] = [];
  const subs = Object.keys(MODELS).map(Number);
  for (const sub of subs) {
    const m = MODELS[sub];
    for (let month = 1; month <= 12; month++) {
      // current FY budget (smooth, no jitter)
      pushFacts(out, CURRENT_FY, sub, month, "budget", 1, 0);
      // current FY actuals — only closed months
      if (month <= ACTUAL_MONTHS) {
        pushFacts(out, CURRENT_FY, sub, month, "actual", m.perf, 0.08);
      }
      // prior FY actuals — full year
      pushFacts(out, PRIOR_FY, sub, month, "actual", 1 / m.growth, 0.07);
    }
  }
  return out;
}

export const PL_FACTS: MonthlyFact[] = buildFacts();

// ── bank balances (ties to BS cash row — same source, blueprint §5.2) ────────

const BANK_NOW: Record<number, number> = {
  1: 3_400_000,
  2: 4_100_000,
  5: 1_150_000,
  7: 1_350_000,
  8: 560_000, // below its HKD 600k floor → drives the cash-floor alert demo
};

export function bankSeries30d(): BankPoint[] {
  const out: BankPoint[] = [];
  for (const [subStr, now] of Object.entries(BANK_NOW)) {
    const sub = Number(subStr);
    for (let d = 29; d >= 0; d--) {
      const date = new Date(TODAY.getTime() - d * 86_400_000);
      // walk back from today with a gentle drift + payroll dip on the 28th
      const drift = (d / 29) * now * 0.12 * (rand(`drift${sub}`) - 0.35);
      const wiggle = now * 0.04 * (rand(`bw${sub}|${d}`) - 0.5);
      const payrollDip = date.getUTCDate() >= 28 ? -now * 0.06 : 0;
      const bal = d === 0 ? now : now + drift + wiggle + payrollDip;
      out.push({ date: date.toISOString().slice(0, 10), subsidiaryId: sub, balance: Math.round(bal) });
    }
  }
  return out;
}

export const BANK_POINTS: BankPoint[] = bankSeries30d();
export const BANK_TODAY: Record<number, number> = BANK_NOW;

// ── A/R & A/P open items ─────────────────────────────────────────────────────

const CLIENTS = [
  "Harbourview Retail 宏景零售",
  "Golden Lion F&B 金獅餐飲",
  "MetroTel 都會電訊",
  "Aqua Beauty 碧泉美妝",
  "CityRide 城動出行",
  "Northgate Property 北港置業",
  "Sunrise Insurance 晨曦保險",
  "Peak Fashion 山頂時裝",
  "EverGreen Supermart 長青超市",
  "Lumina Bank 朗銀",
  "Orient Air 東航假期",
  "Vela Watches 星帆鐘錶",
];

const VENDORS = [
  "AdServe Media Buying",
  "Studio Rental Co",
  "PrintWorks Production",
  "Freelance Talent Pool",
  "KOL Network Agency",
  "Cloud & SaaS Vendors",
  "Event Production House",
  "Media Monitoring Service",
];

function buildOpenItems(
  kind: "ar" | "ap",
  totals: Record<number, number>,
  names: string[]
): OpenItem[] {
  const out: OpenItem[] = [];
  // aging mix: weight of [current, 1-30, 31-60, 61-90, 90+]
  const mix = kind === "ar" ? [0.42, 0.26, 0.15, 0.1, 0.07] : [0.55, 0.28, 0.12, 0.05, 0];
  const offsets = [-12, 15, 45, 75, 110]; // days past due (negative = not yet due)
  for (const [subStr, total] of Object.entries(totals)) {
    const sub = Number(subStr);
    let n = 0;
    for (let b = 0; b < mix.length; b++) {
      const bucketTotal = total * mix[b];
      if (bucketTotal < 1000) continue;
      const items = b === 0 ? 4 : b < 3 ? 3 : 2;
      for (let i = 0; i < items; i++) {
        const share = jit(`${kind}${sub}|${b}|${i}`, 0.5) / items;
        const amount = Math.round(bucketTotal * share);
        if (amount < 5_000) continue;
        const overdueDays = offsets[b] + Math.round(rand(`${kind}od${sub}${b}${i}`) * 12);
        const due = new Date(TODAY.getTime() - overdueDays * 86_400_000);
        const tran = new Date(due.getTime() - 30 * 86_400_000);
        out.push({
          txnId: `${kind.toUpperCase()}-${sub}-${++n}`,
          subsidiaryId: sub,
          entityName: names[hashStr(`${kind}${sub}${b}${i}`) % names.length],
          tranDate: tran.toISOString().slice(0, 10),
          dueDate: due.toISOString().slice(0, 10),
          amountOpen: amount,
        });
      }
    }
  }
  return out;
}

export const AR_OPEN: OpenItem[] = buildOpenItems(
  "ar",
  { 1: 2_200_000, 2: 4_400_000, 5: 1_200_000, 7: 2_400_000, 8: 1_100_000 },
  CLIENTS
);

export const AP_OPEN: OpenItem[] = buildOpenItems(
  "ap",
  { 1: 700_000, 2: 1_700_000, 5: 350_000, 7: 650_000, 8: 300_000 },
  VENDORS
);

// ── cost-center department weights (per sub) ─────────────────────────────────
// deptId → share of that subsidiary's tagged opex+COS. Untagged share is
// modelled separately (audit §1.3: only 54% of vendor bill lines carry a dept).

export const DEPT_WEIGHTS: Record<number, Record<number, number>> = {
  1: { 101: 0.3, 102: 0.12, 105: 0.14, 107: 0.08, 9: 0.12, 6: 0.16, 11: 0.08 },
  2: { 103: 0.3, 104: 0.16, 106: 0.18, 108: 0.16, 105: 0.1, 9: 0.05, 6: 0.05 },
  5: { 102: 0.42, 108: 0.22, 105: 0.16, 6: 0.1, 9: 0.1 },
  7: { 109: 0.34, 110: 0.16, 111: 0.22, 103: 0.12, 6: 0.08, 9: 0.08 },
  8: { 102: 0.55, 108: 0.2, 105: 0.1, 6: 0.08, 9: 0.07 },
};

/** untagged share of cost lines for a given FY month of the current FY */
export function untaggedShare(month: number): number {
  return 0.46 - month * 0.012 + (rand(`ut${month}`) - 0.5) * 0.03;
}

/** tagging hygiene trend — last 14 months (count + % of vendor-bill lines without dept) */
export function taggingTrend(): { label: string; untaggedPct: number; untaggedLines: number }[] {
  const out: { label: string; untaggedPct: number; untaggedLines: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    // walk months back from current FY month 4 (Jul 2026)
    const fyIdx = 4 - i; // may be ≤ 0 → prior FY
    const pct = 0.52 - (14 - i) * 0.011 + (rand(`tg${i}`) - 0.5) * 0.04;
    const cal = fyMonthToCalendar(((fyIdx - 1 + 24) % 12) + 1, fyIdx <= 0 ? 2025 : 2026);
    out.push({
      label: `${cal.year}-${String(cal.month).padStart(2, "0")}`,
      untaggedPct: Math.round(pct * 1000) / 10,
      untaggedLines: Math.round(190 * pct * jit(`tgl${i}`, 0.15)),
    });
  }
  return out;
}

// ── payroll (fact_payroll_monthly) ───────────────────────────────────────────

const HEADCOUNT: Record<number, number> = { 1: 18, 2: 26, 5: 9, 7: 16, 8: 10 };

export function payrollRows(): PayrollRow[] {
  const out: PayrollRow[] = [];
  for (const [subStr, hc] of Object.entries(HEADCOUNT)) {
    const sub = Number(subStr);
    const staffAnnual = MODELS[sub].opex.OPEX_STAFF;
    const weights = DEPT_WEIGHTS[sub];
    const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
    for (let month = 1; month <= ACTUAL_MONTHS; month++) {
      for (const [deptStr, w] of Object.entries(weights)) {
        const dept = Number(deptStr);
        const total = (staffAnnual / 12) * (w / wSum);
        const basic = total / 1.045;
        out.push({
          subsidiaryId: sub,
          departmentId: dept,
          month,
          headcount: Math.max(1, Math.round(hc * (w / wSum))),
          basicSalary: Math.round(basic),
          mpfEr: Math.round(total - basic),
          totalCost: Math.round(total),
        });
      }
    }
  }
  return out;
}

export const PAYROLL: PayrollRow[] = payrollRows();
export const GROUP_HEADCOUNT = Object.values(HEADCOUNT).reduce((a, b) => a + b, 0);

// ── recurring cash items (13-week forecast inputs, accountant-maintained) ────

export const RECURRING: RecurringCashItem[] = [
  { subsidiaryId: 1, label: "租金 — 中環寫字樓", direction: "out", amount: 120_000, dayOfMonth: 1 },
  { subsidiaryId: 2, label: "租金 — 觀塘寫字樓", direction: "out", amount: 140_000, dayOfMonth: 1 },
  { subsidiaryId: 5, label: "租金 — 工作室", direction: "out", amount: 80_000, dayOfMonth: 1 },
  { subsidiaryId: 7, label: "租金 — 銅鑼灣寫字樓", direction: "out", amount: 100_000, dayOfMonth: 1 },
  { subsidiaryId: 8, label: "租金 — 廠房/器材倉", direction: "out", amount: 70_000, dayOfMonth: 1 },
  { subsidiaryId: 1, label: "MPF 供款（集團代扣）", direction: "out", amount: 95_000, dayOfMonth: 10 },
  { subsidiaryId: 1, label: "聯營公司股息（預計）", direction: "in", amount: 600_000, dayOfMonth: 15 },
];

// ── client revenue concentration (KPI §6.2) ──────────────────────────────────

export const CLIENT_REVENUE_SHARE: { name: string; share: number }[] = [
  { name: CLIENTS[0], share: 0.14 },
  { name: CLIENTS[1], share: 0.11 },
  { name: CLIENTS[2], share: 0.09 },
  { name: CLIENTS[3], share: 0.07 },
  { name: CLIENTS[4], share: 0.06 },
  { name: CLIENTS[5], share: 0.055 },
  { name: CLIENTS[6], share: 0.05 },
  { name: CLIENTS[7], share: 0.045 },
  { name: CLIENTS[8], share: 0.04 },
  { name: CLIENTS[9], share: 0.03 },
];

export const RETAINER_SHARE = 0.58; // retainer vs project revenue (Phase 2 refines)

// ── weekly customer revenue & cashflow (§5.4 tab 2) ──────────────────────────

export interface WeeklyClientRow {
  client: string;
  billed: number;
  collected: number;
  endingAr: number;
}

export function weeklyClientReport(): { weekOf: string; rows: WeeklyClientRow[] } {
  const monday = new Date(TODAY.getTime() - ((TODAY.getUTCDay() + 6) % 7) * 86_400_000);
  const rows: WeeklyClientRow[] = CLIENTS.slice(0, 8).map((c, i) => {
    const billed = Math.round(rand(`wb${i}`) * 420_000);
    const collected = Math.round(rand(`wc${i}`) * 380_000);
    const endingAr = Math.round(180_000 + rand(`we${i}`) * 1_400_000);
    return { client: c, billed, collected, endingAr };
  });
  return { weekOf: monday.toISOString().slice(0, 10), rows };
}

export function weeklyCashSeries(): { week: string; cashIn: number; cashOut: number }[] {
  const out: { week: string; cashIn: number; cashOut: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const monday = new Date(TODAY.getTime() - (((TODAY.getUTCDay() + 6) % 7) + w * 7) * 86_400_000);
    out.push({
      week: monday.toISOString().slice(5, 10),
      cashIn: Math.round(1_500_000 * jit(`wi${w}`, 0.35)),
      cashOut: Math.round(1_380_000 * jit(`wo${w}`, 0.3)),
    });
  }
  return out;
}

// ── data freshness (sync_log in production) ──────────────────────────────────

export const DATA_AS_OF = "2026-08-06 09:00 HKT";
export const IS_DEMO = true;
