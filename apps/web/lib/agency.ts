// ─────────────────────────────────────────────────────────────────────────────
// Agency 營運數據層（demo）— 客戶盈利、利用率、backlog、interco、行業線。
//
// Production 時呢一組 signatures 改由 Supabase 讀取（client_dim /
// fact_client_pnl / timesheet facts / retainer_schedule …），頁面唔使改。
// 依家啲數係虛構 demo：寫死或由 lib/demo.ts 嘅 seeded facts（經
// lib/queries.ts 嘅 sumFacts / kpiAgi）推導，deterministic — 冇 Math.random、
// 冇 Date.now，每次 build 數字一樣，而且同 P&L 頁的 26.0M YTD 收入、
// 15.1M AGI、9.6M 員工成本自洽。
//
// 約定：金額一律 HKD；所有 *Pct 欄位係 0–100 百分比數值（唔係 0–1 fraction）；
// month 一律係 FY 月份（1 = 4 月，FY2026/27 已關帳至 month 4 = 2026-07）。
// ─────────────────────────────────────────────────────────────────────────────

import { AR_OPEN } from "./demo";
import { OPERATING_SUBS } from "./dims";
import { ACTUAL_MONTHS, CURRENT_FY, PRIOR_FY } from "./fy";
import { ALL_SUB_IDS, kpiAgi, resolveSubs, sumFacts } from "./queries";

// ── shared helpers ───────────────────────────────────────────────────────────

const YTD: number[] = Array.from({ length: ACTUAL_MONTHS }, (_, i) => i + 1);
const ALL_12: number[] = Array.from({ length: 12 }, (_, i) => i + 1);
const REV_CODES = ["REV_SERVICE", "REV_TRAVEL", "REV_GOODS"];
const COS_CODES = ["COS_SERVICES", "COS_GOODS"];

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 某公司於指定月份嘅實際總收入（HKD） */
function subRev(subId: number, months: number[]): number {
  return sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [subId], months, groups: REV_CODES });
}

/** 某公司於指定月份嘅實際員工成本（HKD） */
function subStaff(subId: number, months: number[]): number {
  return sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [subId], months, groups: ["OPEX_STAFF"] });
}

// ── client master（production: client_dim，由 NetSuite customer 同步） ────────

export interface ClientRec {
  id: string;
  name: string;
  subsidiaryId: number;
  sector: string;
  isRetainer: boolean;
  isInterco: boolean;
  /** 信用額（千 HKD）；null = 未設限額 */
  creditLimitK: number | null;
  firstInvoiceFy: string;
}

/** 內部 book：ClientRec + 分攤參數。
 *  revShare = 佔該公司收入比例（每間公司加總 = 1）；
 *  dcRatio  = 直接成本 ÷ 收入；
 *  staffShare = 佔該公司員工成本比例（timesheet 分攤，每間公司加總 = 1）。 */
interface BookEntry extends ClientRec {
  revShare: number;
  dcRatio: number;
  staffShare: number;
}

const BOOK: BookEntry[] = [
  // ── Social Strategy（sub 2）— 最多客 ──
  { id: "c01", name: "Harbourview Retail 宏景零售", subsidiaryId: 2, sector: "零售", isRetainer: true, isInterco: false, creditLimitK: 1500, firstInvoiceFy: "FY2021/22", revShare: 0.255, dcRatio: 0.46, staffShare: 0.185 },
  { id: "c02", name: "Golden Lion F&B 金獅餐飲", subsidiaryId: 2, sector: "餐飲", isRetainer: true, isInterco: false, creditLimitK: 1000, firstInvoiceFy: "FY2022/23", revShare: 0.15, dcRatio: 0.44, staffShare: 0.13 },
  { id: "c03", name: "Meridian Bank 銘峰銀行", subsidiaryId: 2, sector: "金融", isRetainer: true, isInterco: false, creditLimitK: 1200, firstInvoiceFy: "FY2023/24", revShare: 0.12, dcRatio: 0.4, staffShare: 0.09 },
  // 超服務案例：收入唔細，但 timesheet 分攤後蝕錢
  { id: "c04", name: "Lumina Beauty 麗曜美妝", subsidiaryId: 2, sector: "美妝", isRetainer: true, isInterco: false, creditLimitK: 500, firstInvoiceFy: "FY2023/24", revShare: 0.09, dcRatio: 0.15, staffShare: 0.23 },
  { id: "c05", name: "Vertex Motors 域陞汽車", subsidiaryId: 2, sector: "汽車", isRetainer: false, isInterco: false, creditLimitK: 600, firstInvoiceFy: "FY2024/25", revShare: 0.07, dcRatio: 0.52, staffShare: 0.11 },
  { id: "c06", name: "EverGreen Supermart 長青超市", subsidiaryId: 2, sector: "零售", isRetainer: true, isInterco: false, creditLimitK: 800, firstInvoiceFy: "FY2022/23", revShare: 0.08, dcRatio: 0.45, staffShare: 0.06 },
  { id: "c07", name: "Aqua Beauty 碧泉美妝", subsidiaryId: 2, sector: "美妝", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25", revShare: 0.06, dcRatio: 0.5, staffShare: 0.045 },
  { id: "c08", name: "CityRide 城動出行", subsidiaryId: 2, sector: "出行", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2025/26", revShare: 0.05, dcRatio: 0.48, staffShare: 0.04 },
  { id: "c09", name: "Peak Fashion 山頂時裝", subsidiaryId: 2, sector: "時裝", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2025/26", revShare: 0.045, dcRatio: 0.47, staffShare: 0.035 },
  { id: "c10", name: "Skyline Fintech 雲嶺金融科技", subsidiaryId: 2, sector: "金融", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2026/27", revShare: 0.035, dcRatio: 0.42, staffShare: 0.03 },
  { id: "c11", name: "Photoblog.hk（集團內・支援服務）", subsidiaryId: 2, sector: "集團內", isRetainer: true, isInterco: true, creditLimitK: null, firstInvoiceFy: "FY2021/22", revShare: 0.045, dcRatio: 0.3, staffShare: 0.045 },

  // ── Photoblog（sub 1） ──
  // 超服務案例二
  { id: "c12", name: "Cascade Telecom 川滙電訊", subsidiaryId: 1, sector: "電訊", isRetainer: true, isInterco: false, creditLimitK: 600, firstInvoiceFy: "FY2022/23", revShare: 0.1, dcRatio: 0.16, staffShare: 0.25 },
  { id: "c13", name: "Lumina Bank 朗銀", subsidiaryId: 1, sector: "金融", isRetainer: true, isInterco: false, creditLimitK: 1200, firstInvoiceFy: "FY2021/22", revShare: 0.24, dcRatio: 0.3, staffShare: 0.17 },
  { id: "c14", name: "Northgate Property 北港置業", subsidiaryId: 1, sector: "地產", isRetainer: true, isInterco: false, creditLimitK: 900, firstInvoiceFy: "FY2022/23", revShare: 0.18, dcRatio: 0.32, staffShare: 0.14 },
  { id: "c15", name: "Orchid Hotels 蘭庭酒店", subsidiaryId: 1, sector: "酒店", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25", revShare: 0.14, dcRatio: 0.38, staffShare: 0.11 },
  { id: "c16", name: "Vela Watches 星帆鐘錶", subsidiaryId: 1, sector: "鐘錶", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2023/24", revShare: 0.12, dcRatio: 0.36, staffShare: 0.1 },
  { id: "c17", name: "Solaris Energy 晴陽能源", subsidiaryId: 1, sector: "能源", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2026/27", revShare: 0.1, dcRatio: 0.34, staffShare: 0.09 },
  { id: "c18", name: "MetroTel 都會電訊", subsidiaryId: 1, sector: "電訊", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2025/26", revShare: 0.08, dcRatio: 0.34, staffShare: 0.09 },
  { id: "c19", name: "Jervois M（集團內・內容製作）", subsidiaryId: 1, sector: "集團內", isRetainer: true, isInterco: true, creditLimitK: null, firstInvoiceFy: "FY2022/23", revShare: 0.04, dcRatio: 0.25, staffShare: 0.05 },

  // ── Jervois M（sub 7） ──
  { id: "c20", name: "Pacific Crown Hotels 環冠酒店", subsidiaryId: 7, sector: "酒店", isRetainer: true, isInterco: false, creditLimitK: 900, firstInvoiceFy: "FY2022/23", revShare: 0.2, dcRatio: 0.42, staffShare: 0.16 },
  // 超服務案例三
  { id: "c21", name: "Sunrise Insurance 晨曦保險", subsidiaryId: 7, sector: "保險", isRetainer: true, isInterco: false, creditLimitK: 500, firstInvoiceFy: "FY2023/24", revShare: 0.08, dcRatio: 0.13, staffShare: 0.26 },
  { id: "c22", name: "Stellar Cruises 星輝郵輪", subsidiaryId: 7, sector: "旅遊", isRetainer: false, isInterco: false, creditLimitK: 400, firstInvoiceFy: "FY2024/25", revShare: 0.17, dcRatio: 0.6, staffShare: 0.12 },
  { id: "c23", name: "Wanderlust Tours 縱橫旅遊", subsidiaryId: 7, sector: "旅遊", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25", revShare: 0.15, dcRatio: 0.65, staffShare: 0.09 },
  { id: "c24", name: "Regal Jewellery 瑞閣珠寶", subsidiaryId: 7, sector: "珠寶", isRetainer: true, isInterco: false, creditLimitK: 700, firstInvoiceFy: "FY2023/24", revShare: 0.14, dcRatio: 0.38, staffShare: 0.12 },
  { id: "c25", name: "Kingsway Mall 京滙商場", subsidiaryId: 7, sector: "零售", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2026/27", revShare: 0.12, dcRatio: 0.4, staffShare: 0.1 },
  { id: "c26", name: "Orient Air 東航假期", subsidiaryId: 7, sector: "旅遊", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2025/26", revShare: 0.115, dcRatio: 0.62, staffShare: 0.12 },
  { id: "c27", name: "Photoblog.hk（集團內・旅遊代訂）", subsidiaryId: 7, sector: "集團內", isRetainer: false, isInterco: true, creditLimitK: null, firstInvoiceFy: "FY2023/24", revShare: 0.025, dcRatio: 0.4, staffShare: 0.03 },

  // ── CLS GARAGE（sub 5） ──
  { id: "c28", name: "Velocity Auto Parts 迅達汽配", subsidiaryId: 5, sector: "汽車", isRetainer: true, isInterco: false, creditLimitK: 600, firstInvoiceFy: "FY2023/24", revShare: 0.32, dcRatio: 0.45, staffShare: 0.3 },
  { id: "c29", name: "Ridgeline Outdoor 嶺越戶外", subsidiaryId: 5, sector: "戶外用品", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25", revShare: 0.28, dcRatio: 0.48, staffShare: 0.26 },
  { id: "c30", name: "Nova Gadgets 新宇數碼", subsidiaryId: 5, sector: "電子", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2026/27", revShare: 0.22, dcRatio: 0.5, staffShare: 0.24 },
  { id: "c31", name: "Urban Brew 城釀咖啡", subsidiaryId: 5, sector: "餐飲", isRetainer: true, isInterco: false, creditLimitK: 300, firstInvoiceFy: "FY2025/26", revShare: 0.18, dcRatio: 0.42, staffShare: 0.2 },

  // ── 704 Production（sub 8） ──
  { id: "c32", name: "Silverscreen Studios 銀幕製作", subsidiaryId: 8, sector: "娛樂", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2023/24", revShare: 0.3, dcRatio: 0.36, staffShare: 0.33 },
  { id: "c33", name: "Skybridge Media 天橋傳媒", subsidiaryId: 8, sector: "媒體", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25", revShare: 0.27, dcRatio: 0.35, staffShare: 0.25 },
  { id: "c34", name: "Grand Casa Furnishing 尚居家品", subsidiaryId: 8, sector: "家品", isRetainer: true, isInterco: false, creditLimitK: 400, firstInvoiceFy: "FY2023/24", revShare: 0.23, dcRatio: 0.34, staffShare: 0.22 },
  { id: "c35", name: "Bloom Wellness 沁悅養生", subsidiaryId: 8, sector: "保健", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2026/27", revShare: 0.2, dcRatio: 0.33, staffShare: 0.2 },
];

function toRec(c: BookEntry): ClientRec {
  const { revShare: _r, dcRatio: _d, staffShare: _s, ...rec } = c;
  return rec;
}

// ── client P&L ───────────────────────────────────────────────────────────────

export interface ClientPnlRow {
  client: ClientRec;
  revenue: number;
  directCost: number;
  staffCost: number;
  margin: number;
  /** margin ÷ revenue，0–100 */
  marginPct: number;
}

/** 客戶損益（收入 − 直接成本 − timesheet 分攤員工成本）。
 *  subSel = -1 全集團；months = FY26/27 月份陣列。
 *  外部客戶合計 ≈ 合併收入 26.0M（YTD）；interco 行（合計 ~0.74M）即係
 *  Elimination 沖銷嗰部分，頁面可以分開列示。 */
export function clientPnl(subSel: number, months: number[]): ClientPnlRow[] {
  const subs = new Set(subSel === -1 ? OPERATING_SUBS.map((s) => s.id) : [subSel]);
  const rows: ClientPnlRow[] = [];
  for (const c of BOOK) {
    if (!subs.has(c.subsidiaryId)) continue;
    const revenue = Math.round(c.revShare * subRev(c.subsidiaryId, months));
    const directCost = Math.round(revenue * c.dcRatio);
    const staffCost = Math.round(c.staffShare * subStaff(c.subsidiaryId, months));
    const margin = revenue - directCost - staffCost;
    rows.push({
      client: toRec(c),
      revenue,
      directCost,
      staffCost,
      margin,
      marginPct: revenue ? round1((margin / revenue) * 100) : 0,
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

// ── new vs existing revenue ──────────────────────────────────────────────────

/** 本 FY 新客（firstInvoiceFy = FY2026/27）收入比重逐月，新客佔比慢慢升。 */
const NEW_CLIENT_SHARE = [0.1, 0.12, 0.135, 0.155];

export function newVsExisting(): { month: number; newRev: number; existingRev: number }[] {
  const out: { month: number; newRev: number; existingRev: number }[] = [];
  for (let m = 1; m <= ACTUAL_MONTHS; m++) {
    const total = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: [m], groups: REV_CODES });
    const newRev = Math.round(total * (NEW_CLIENT_SHARE[m - 1] ?? 0.15));
    out.push({ month: m, newRev, existingRev: Math.round(total) - newRev });
  }
  return out;
}

// ── churn ────────────────────────────────────────────────────────────────────

/** 上年有開票、今年 4 個月零收入嘅流失客（production: 對比兩個 FY 嘅發票客戶集合） */
const LOST_CLIENTS: { client: ClientRec; lastFyRevenue: number }[] = [
  {
    client: { id: "x01", name: "Crimson Apparel 緋紅服飾", subsidiaryId: 2, sector: "時裝", isRetainer: true, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2023/24" },
    lastFyRevenue: 1_850_000,
  },
  {
    client: { id: "x02", name: "BayPoint Fitness 灣角健身", subsidiaryId: 7, sector: "健身", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2024/25" },
    lastFyRevenue: 920_000,
  },
  {
    client: { id: "x03", name: "Quartz Property 晶石置業", subsidiaryId: 1, sector: "地產", isRetainer: false, isInterco: false, creditLimitK: null, firstInvoiceFy: "FY2022/23" },
    lastFyRevenue: 640_000,
  },
];

/** 上 FY 有效客戶基數（小額客唔入 roster；production 由發票數推） */
const PRIOR_FY_CLIENT_BASE = 20;

export function churnStats(): {
  lostClients: { client: ClientRec; lastFyRevenue: number }[];
  clientRetentionPct: number;
  revenueRetentionPct: number;
} {
  const priorRev = sumFacts({ fy: PRIOR_FY, kind: "actual", subIds: ALL_SUB_IDS, months: ALL_12, groups: REV_CODES });
  const existingYtd = newVsExisting().reduce((a, r) => a + r.existingRev, 0);
  const existingAnnualised = (existingYtd / ACTUAL_MONTHS) * 12;
  return {
    lostClients: LOST_CLIENTS,
    clientRetentionPct: round1((100 * (PRIOR_FY_CLIENT_BASE - LOST_CLIENTS.length)) / PRIOR_FY_CLIENT_BASE),
    revenueRetentionPct: round1((100 * existingAnnualised) / priorRev),
  };
}

// ── credit exposure ──────────────────────────────────────────────────────────

/** 各主要客戶未收 AR + 已承諾媒體投放（千位 id → HKD） */
const EXPOSURE: Record<string, { ar: number; media: number }> = {
  c01: { ar: 980_000, media: 620_000 }, // Harbourview — 爆 limit
  c04: { ar: 430_000, media: 95_000 }, // Lumina Beauty — 爆 limit + 超服務
  c02: { ar: 560_000, media: 320_000 },
  c03: { ar: 410_000, media: 150_000 },
  c05: { ar: 310_000, media: 180_000 },
  c06: { ar: 340_000, media: 210_000 },
  c13: { ar: 620_000, media: 0 },
  c20: { ar: 460_000, media: 120_000 },
  c22: { ar: 240_000, media: 90_000 },
  c26: { ar: 350_000, media: 0 },
};

export function creditExposure(): { client: ClientRec; arOpen: number; committedMedia: number; utilisationPct: number | null }[] {
  const rows = BOOK.filter((c) => EXPOSURE[c.id]).map((c) => {
    const e = EXPOSURE[c.id];
    const util = c.creditLimitK ? round1((100 * (e.ar + e.media)) / (c.creditLimitK * 1000)) : null;
    return { client: toRec(c), arOpen: e.ar, committedMedia: e.media, utilisationPct: util };
  });
  return rows.sort((a, b) => (b.utilisationPct ?? -1) - (a.utilisationPct ?? -1));
}

// ── pitch（比稿）─────────────────────────────────────────────────────────────

const PITCH_ROWS = [
  { month: 1, pitches: 6, won: 2, hoursCost: 145_000 },
  { month: 2, pitches: 7, won: 2, hoursCost: 168_000 },
  { month: 3, pitches: 5, won: 2, hoursCost: 128_000 },
  { month: 4, pitches: 8, won: 2, hoursCost: 190_000 },
];

export function pitchStats(): {
  rows: { month: number; pitches: number; won: number; hoursCost: number }[];
  winRatePct: number;
  costPerWin: number;
} {
  const pitches = PITCH_ROWS.reduce((a, r) => a + r.pitches, 0);
  const won = PITCH_ROWS.reduce((a, r) => a + r.won, 0);
  const cost = PITCH_ROWS.reduce((a, r) => a + r.hoursCost, 0);
  return {
    rows: PITCH_ROWS,
    winRatePct: round1((100 * won) / pitches),
    costPerWin: won ? Math.round(cost / won) : 0,
  };
}

// ── utilisation（timesheet）──────────────────────────────────────────────────

/** fee-earning teams：billable / capacity 係 YTD 4 個月合計小時。
 *  agiWeight = 該 team 佔所屬公司 AGI 比例（每間公司加總 = 1）。 */
const TEAMS = [
  { team: "編輯部（Photoblog）", subsidiaryId: 1, billableHours: 2_050, capacityHours: 3_600, agiWeight: 0.55 },
  { team: "Commercial Team（Photoblog）", subsidiaryId: 1, billableHours: 1_780, capacityHours: 2_400, agiWeight: 0.45 },
  { team: "客戶服務（SSHK）", subsidiaryId: 2, billableHours: 3_890, capacityHours: 4_800, agiWeight: 0.36 },
  { team: "Creative Team（SSHK）", subsidiaryId: 2, billableHours: 3_480, capacityHours: 4_200, agiWeight: 0.32 },
  { team: "Monitoring & Seeding（SSHK）", subsidiaryId: 2, billableHours: 1_560, capacityHours: 2_400, agiWeight: 0.17 },
  { team: "ePR Team（SSHK）", subsidiaryId: 2, billableHours: 1_620, capacityHours: 3_000, agiWeight: 0.15 }, // 明顯偏低
  { team: "製作部（CLS）", subsidiaryId: 5, billableHours: 2_150, capacityHours: 3_000, agiWeight: 1 },
  { team: "JM Team（Jervois M）", subsidiaryId: 7, billableHours: 4_050, capacityHours: 5_400, agiWeight: 0.75 },
  { team: "旅遊部（Jervois M）", subsidiaryId: 7, billableHours: 1_690, capacityHours: 2_400, agiWeight: 0.25 },
  { team: "製作部（704）", subsidiaryId: 8, billableHours: 3_220, capacityHours: 4_800, agiWeight: 1 },
];

export function utilisationByTeam(): { team: string; subsidiaryId: number; billableHours: number; capacityHours: number; utilPct: number }[] {
  return TEAMS.map((t) => ({
    team: t.team,
    subsidiaryId: t.subsidiaryId,
    billableHours: t.billableHours,
    capacityHours: t.capacityHours,
    utilPct: round1((100 * t.billableHours) / t.capacityHours),
  })).sort((a, b) => b.utilPct - a.utilPct);
}

/** 集團整體 utilisation 逐月（平均 ≈ 70.7%，同 byTeam 合計一致） */
export function utilisationTrend(): { month: number; utilPct: number }[] {
  const pcts = [68.8, 70.4, 71.9, 71.6];
  return YTD.map((m) => ({ month: m, utilPct: pcts[m - 1] ?? 70 }));
}

// ── effective rate（AGI ÷ billable hours）────────────────────────────────────

export function effectiveRate(): { byTeam: { team: string; agi: number; billableHours: number; rate: number }[]; overall: number } {
  const byTeam = TEAMS.map((t) => {
    const agi = Math.round(kpiAgi(t.subsidiaryId, YTD).agi * t.agiWeight);
    return { team: t.team, agi, billableHours: t.billableHours, rate: Math.round(agi / t.billableHours) };
  }).sort((a, b) => b.rate - a.rate);
  const totalHours = TEAMS.reduce((a, t) => a + t.billableHours, 0);
  // overall 用合併 AGI（含 Elimination），所以會略低過各 team 加總
  return { byTeam, overall: Math.round(kpiAgi(-1, YTD).agi / totalHours) };
}

// ── over-servicing（retainer 客時間成本 vs fee）──────────────────────────────

/** timesheet 成本 loading（薪金 + MPF + 直接 oncost） */
const TIME_LOADING = 1.12;

/** ratioPct = timeCost ÷ fee（>100 = 超服務），由差到好排。 */
export function overServicing(): { client: ClientRec; feeYtd: number; timeCostYtd: number; ratioPct: number }[] {
  return BOOK.filter((c) => c.isRetainer && !c.isInterco)
    .map((c) => {
      const feeYtd = Math.round(c.revShare * subRev(c.subsidiaryId, YTD));
      const timeCostYtd = Math.round(c.staffShare * subStaff(c.subsidiaryId, YTD) * TIME_LOADING);
      return { client: toRec(c), feeYtd, timeCostYtd, ratioPct: feeYtd ? round1((100 * timeCostYtd) / feeYtd) : 0 };
    })
    .sort((a, b) => b.ratioPct - a.ratioPct);
}

// ── freelance vs internal ────────────────────────────────────────────────────

/** 外判/freelance 支出（屬服務成本一部分），近月趨升 */
const FREELANCE_BY_MONTH = [420_000, 486_000, 552_000, 648_000];

export function freelanceRatio(): { month: number; freelanceCost: number; internalCost: number; ratioPct: number }[] {
  return YTD.map((m) => {
    const freelanceCost = FREELANCE_BY_MONTH[m - 1] ?? 500_000;
    const internalCost = Math.round(
      sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: [m], groups: ["OPEX_STAFF"] })
    );
    return { month: m, freelanceCost, internalCost, ratioPct: round1((100 * freelanceCost) / (freelanceCost + internalCost)) };
  });
}

// ── headcount ────────────────────────────────────────────────────────────────

const HC_BY_MONTH: { month: number; bySub: Record<number, number>; feeEarners: number }[] = [
  { month: 1, bySub: { 1: 18, 2: 26, 5: 9, 7: 16, 8: 10 }, feeEarners: 61 },
  { month: 2, bySub: { 1: 18, 2: 26, 5: 9, 7: 16, 8: 10 }, feeEarners: 61 },
  { month: 3, bySub: { 1: 18, 2: 27, 5: 9, 7: 16, 8: 10 }, feeEarners: 62 },
  { month: 4, bySub: { 1: 17, 2: 27, 5: 9, 7: 17, 8: 10 }, feeEarners: 63 },
];

export function headcountTrend(): { month: number; bySub: Record<number, number>; feeEarners: number; total: number }[] {
  return HC_BY_MONTH.map((r) => ({
    ...r,
    total: Object.values(r.bySub).reduce((a, b) => a + b, 0),
  }));
}

export function agiPerFeeEarner(months: number[]): { agi: number; feeEarners: number; annualised: number } {
  const agi = Math.round(kpiAgi(-1, months).agi);
  const feeEarners = HC_BY_MONTH[HC_BY_MONTH.length - 1].feeEarners;
  const annualised = months.length ? Math.round(((agi / months.length) * 12) / feeEarners) : 0;
  return { agi, feeEarners, annualised };
}

// ── ratio suite（全部 ÷ AGI，0–100）──────────────────────────────────────────

export function ratioSuite(months: number[]): { staffToAgiPct: number; overheadToAgiPct: number; ebitdaToAgiPct: number } {
  const agi = kpiAgi(-1, months).agi || 1;
  const base = { fy: CURRENT_FY, kind: "actual" as const, subIds: ALL_SUB_IDS, months };
  const staff = sumFacts({ ...base, groups: ["OPEX_STAFF"] });
  const opex = sumFacts({ ...base, groups: ["OPEX_STAFF", "OPEX_RENT", "OPEX_DEPRECIATION", "OPEX_ADMIN", "OPEX_IT", "OPEX_MARKETING", "OPEX_OTHER"] });
  const dep = sumFacts({ ...base, groups: ["OPEX_DEPRECIATION"] });
  const rev = sumFacts({ ...base, groups: REV_CODES });
  const cos = sumFacts({ ...base, groups: COS_CODES });
  const ebitda = rev - cos - opex + dep;
  return {
    staffToAgiPct: round1((100 * staff) / agi),
    overheadToAgiPct: round1((100 * (opex - staff)) / agi),
    ebitdaToAgiPct: round1((100 * ebitda) / agi),
  };
}

// ── backlog coverage（已簽約收入 vs 預算）────────────────────────────────────

const QUARTER_DEFS = [
  { label: "FY Q2 餘下（8–9月）", months: [5, 6], contracted: 12_300_000 },
  { label: "FY Q3（10–12月）", months: [7, 8, 9], contracted: 15_100_000 },
  { label: "FY Q4（1–3月）", months: [10, 11, 12], contracted: 6_600_000 },
];

/** retainer 月費清單（人手維護；endMonth = 合約完 YYYY-MM） */
const RETAINERS: { client: string; subsidiaryId: number; monthly: number; endMonth: string }[] = [
  { client: "Harbourview Retail 宏景零售", subsidiaryId: 2, monthly: 580_000, endMonth: "2027-03" },
  { client: "Golden Lion F&B 金獅餐飲", subsidiaryId: 2, monthly: 340_000, endMonth: "2026-12" },
  { client: "Lumina Bank 朗銀", subsidiaryId: 1, monthly: 335_000, endMonth: "2027-03" },
  { client: "Velocity Auto Parts 迅達汽配", subsidiaryId: 5, monthly: 285_000, endMonth: "2027-03" },
  { client: "Pacific Crown Hotels 環冠酒店", subsidiaryId: 7, monthly: 280_000, endMonth: "2027-02" },
  { client: "Meridian Bank 銘峰銀行", subsidiaryId: 2, monthly: 275_000, endMonth: "2027-03" },
  { client: "Northgate Property 北港置業", subsidiaryId: 1, monthly: 250_000, endMonth: "2026-11" },
  { client: "Lumina Beauty 麗曜美妝", subsidiaryId: 2, monthly: 205_000, endMonth: "2026-10" },
  { client: "Regal Jewellery 瑞閣珠寶", subsidiaryId: 7, monthly: 197_000, endMonth: "2027-01" },
  { client: "EverGreen Supermart 長青超市", subsidiaryId: 2, monthly: 180_000, endMonth: "2027-01" },
  { client: "Grand Casa Furnishing 尚居家品", subsidiaryId: 8, monthly: 165_000, endMonth: "2027-02" },
  { client: "Urban Brew 城釀咖啡", subsidiaryId: 5, monthly: 160_000, endMonth: "2026-12" },
  { client: "Cascade Telecom 川滙電訊", subsidiaryId: 1, monthly: 140_000, endMonth: "2026-09" },
  { client: "Sunrise Insurance 晨曦保險", subsidiaryId: 7, monthly: 113_000, endMonth: "2026-09" },
];

export function backlogCoverage(): {
  quarters: { label: string; budgetRev: number; contracted: number; coveragePct: number }[];
  retainers: { client: string; subsidiaryId: number; monthly: number; endMonth: string }[];
} {
  const quarters = QUARTER_DEFS.map((q) => {
    const budgetRev = Math.round(
      sumFacts({ fy: CURRENT_FY, kind: "budget", subIds: ALL_SUB_IDS, months: q.months, groups: REV_CODES })
    );
    return { label: q.label, budgetRev, contracted: q.contracted, coveragePct: round1((100 * q.contracted) / budgetRev) };
  });
  return { quarters, retainers: RETAINERS };
}

// ── 利得稅時間表（每間公司兩期，合共 ~1.14M）────────────────────────────────

export function taxSchedule(): { subsidiaryId: number; label: string; dueDate: string; amount: number }[] {
  const inst: { subsidiaryId: number; first: number; second: number }[] = [
    { subsidiaryId: 1, first: 240_000, second: 80_000 },
    { subsidiaryId: 2, first: 375_000, second: 125_000 },
    { subsidiaryId: 5, first: 82_000, second: 27_000 },
    { subsidiaryId: 7, first: 128_000, second: 43_000 },
    { subsidiaryId: 8, first: 30_000, second: 10_000 },
  ];
  const out: { subsidiaryId: number; label: string; dueDate: string; amount: number }[] = [];
  for (const i of inst) {
    out.push({ subsidiaryId: i.subsidiaryId, label: "2025/26 最終稅 + 2026/27 暫繳（第 1 期）", dueDate: "2026-11-02", amount: i.first });
    out.push({ subsidiaryId: i.subsidiaryId, label: "2026/27 暫繳利得稅（第 2 期）", dueDate: "2027-01-04", amount: i.second });
  }
  return out;
}

// ── interco balances（from 應收 to 嘅欠款）──────────────────────────────────
// 方向參考 docs/netsuite-verification-2026-08-06.md：SSHK 6.08M AR 入面
// interco 佔大份（Photoblog 2.58M、Jervois M 1.03M、704 109K）。

const INTERCO_BALANCES: { from: string; to: string; amount: number; oldestDays: number }[] = [
  { from: "Social Strategy", to: "Photoblog", amount: 2_530_000, oldestDays: 204 },
  { from: "Social Strategy", to: "Jervois M", amount: 1_020_000, oldestDays: 156 },
  { from: "Social Strategy", to: "704 Production", amount: 110_000, oldestDays: 88 },
  { from: "Photoblog", to: "Jervois M", amount: 380_000, oldestDays: 62 },
  { from: "Jervois M", to: "Photoblog", amount: 240_000, oldestDays: 45 },
];

export function intercoBalances(): { from: string; to: string; amount: number; oldestDays: number }[] {
  return INTERCO_BALANCES;
}

// ── AR split：外部客 vs interco（DSO 應該只計外部）──────────────────────────

const SHORT_TO_ID = new Map(OPERATING_SUBS.map((s) => [s.short, s.id]));

export function arSplit(subSel: number): { external: number; interco: number } {
  const subs = new Set(resolveSubs(subSel));
  const external = AR_OPEN.filter((i) => subs.has(i.subsidiaryId)).reduce((a, i) => a + i.amountOpen, 0);
  const interco = INTERCO_BALANCES.filter((b) => subs.has(SHORT_TO_ID.get(b.from) ?? -99)).reduce(
    (a, b) => a + b.amount,
    0
  );
  return { external: Math.round(external), interco };
}

// ── supplier concentration（COS 集中度）─────────────────────────────────────

/** 佔 YTD COS 比例（%）+ 付款期；頭一名（媒體平台）35%、頭三名 60% */
const VENDOR_SHARE: { vendor: string; pctOfCos: number; termsDays: number }[] = [
  { vendor: "AdServe Media Buying", pctOfCos: 35, termsDays: 30 },
  { vendor: "KOL Network Agency", pctOfCos: 14, termsDays: 45 },
  { vendor: "Freelance Talent Pool", pctOfCos: 11, termsDays: 14 },
  { vendor: "Studio Rental Co", pctOfCos: 6, termsDays: 30 },
  { vendor: "PrintWorks Production", pctOfCos: 5, termsDays: 30 },
  { vendor: "Event Production House", pctOfCos: 4.5, termsDays: 60 },
  { vendor: "Cloud & SaaS Vendors", pctOfCos: 3.5, termsDays: 7 },
  { vendor: "Media Monitoring Service", pctOfCos: 2, termsDays: 30 },
];

export function supplierConcentration(): { vendor: string; ytdSpend: number; pctOfCos: number; termsDays: number }[] {
  const cos = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: YTD, groups: COS_CODES });
  return VENDOR_SHARE.map((v) => ({
    vendor: v.vendor,
    ytdSpend: Math.round((cos * v.pctOfCos) / 100),
    pctOfCos: v.pctOfCos,
    termsDays: v.termsDays,
  }));
}

// ── 行業線：旅遊（Jervois M）────────────────────────────────────────────────

/** 總訂單值（GMV，包客人代收代付部分）；takeRate = 淨收入 ÷ GMV */
const TRAVEL_BOOKINGS = [640_000, 700_000, 660_000, 850_000];

export function travelLine(): { month: number; bookings: number; revenue: number; direct: number; takeRatePct: number }[] {
  return YTD.map((m) => {
    const revenue = Math.round(sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [7], months: [m], groups: ["REV_TRAVEL"] }));
    const direct = Math.round(revenue * 0.82); // 同 demo P&L 嘅 cosTravelRatio 一致
    const bookings = TRAVEL_BOOKINGS[m - 1] ?? 700_000;
    return { month: m, bookings, revenue, direct, takeRatePct: round1((100 * (revenue - direct)) / bookings) };
  });
}

// ── 行業線：商品（Photoblog + CLS）──────────────────────────────────────────

const INVENTORY_END = [605_000, 588_000, 610_000, 596_000];
const SELL_THROUGH = [58, 62, 60, 66];

export function goodsLine(): { month: number; revenue: number; cogs: number; inventoryEnd: number; turnoverX: number; sellThroughPct: number }[] {
  return YTD.map((m) => {
    const revenue = Math.round(sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: [m], groups: ["REV_GOODS"] }));
    const cogs = Math.round(sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: [m], groups: ["COS_GOODS"] }));
    const inventoryEnd = INVENTORY_END[m - 1] ?? 600_000;
    return {
      month: m,
      revenue,
      cogs,
      inventoryEnd,
      turnoverX: round1((cogs * 12) / inventoryEnd), // 年化 COGS ÷ 期末存貨
      sellThroughPct: SELL_THROUGH[m - 1] ?? 60,
    };
  });
}

// ── 行業線：製作（704 Production）───────────────────────────────────────────

const SHOOT_DAYS = [36, 34, 41, 40];
/** 3 隊 crew × 22 工作日 */
const SHOOT_CAPACITY_DAYS = 66;

export function productionLine(): { month: number; shootDays: number; capacityDays: number; utilPct: number; dayRateRevenue: number; depreciation: number }[] {
  return YTD.map((m) => {
    const shootDays = SHOOT_DAYS[m - 1] ?? 38;
    return {
      month: m,
      shootDays,
      capacityDays: SHOOT_CAPACITY_DAYS,
      utilPct: round1((100 * shootDays) / SHOOT_CAPACITY_DAYS),
      dayRateRevenue: Math.round(sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [8], months: [m], groups: ["REV_SERVICE"] })),
      depreciation: Math.round(sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [8], months: [m], groups: ["OPEX_DEPRECIATION"] })),
    };
  });
}

// ── 聯營公司（3 間，per NetSuite 核數）──────────────────────────────────────
// investedCost 合計 2.8M = BS「聯營公司投資」（Photoblog 持有）；
// fyDividends 合計 600K = 本 FY YTD 嘅 ASSOC_INCOME（month 3 入帳）。

export function associatesSummary(): { name: string; investedCost: number; cumulativeDividends: number; fyDividends: number; sharePct: number }[] {
  return [
    { name: "Jervois T Limited", investedCost: 1_200_000, cumulativeDividends: 1_850_000, fyDividends: 600_000, sharePct: 30 },
    { name: "Jervois Solution Limited", investedCost: 800_000, cumulativeDividends: 420_000, fyDividends: 0, sharePct: 25 },
    { name: "Go Asia Plus Travel Limited", investedCost: 800_000, cumulativeDividends: 300_000, fyDividends: 0, sharePct: 20 },
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// 第二批功能（2026-08-07）：找數行為、cross-sell、elimination 完整性、
// PB 中央成本回收、貸款/淨負債/runway、retainer mix、數據完整度。
// Production 一樣行 Supabase；entryLag() 例外 — 佢嘅統計係 2026-08-07 喺
// live NetSuite 度量返嚟嘅真實營運數據（唔係虛構）。
// ═════════════════════════════════════════════════════════════════════════════

// ── 找數行為（payment behaviour）─────────────────────────────────────────────

export interface PaymentBehaviourRow {
  client: ClientRec;
  /** 賬期（日） */
  termsDays: number;
  /** 之前 12 個月平均實際找數日數 */
  avgDaysPrior: number;
  /** 近 3 個月平均 */
  avgDaysRecent: number;
  /** +ve = 惡化緊 */
  deltaDays: number;
  arOpen: number;
}

/** 每客實際找數日數趨勢 — aging 係「已經遲」，呢個係「開始遲」。
 *  Production：由 NetSuite A/R payment history（invoice→payment 配對）計。 */
const PAY_BEHAVIOUR: Record<string, { terms: number; prior: number; recent: number; ar: number }> = {
  c05: { terms: 30, prior: 41, recent: 63, ar: 512_000 }, // Vertex Motors — 惡化最勁
  c26: { terms: 45, prior: 52, recent: 71, ar: 486_000 }, // Orient Air
  c30: { terms: 30, prior: 38, recent: 52, ar: 291_000 }, // Nova Gadgets
  c22: { terms: 45, prior: 58, recent: 66, ar: 655_000 }, // Stellar Cruises
  c01: { terms: 60, prior: 63, recent: 63, ar: 1_120_000 }, // Harbourview — 穩定
  c13: { terms: 60, prior: 66, recent: 62, ar: 890_000 }, // Lumina Bank — 改善
  c03: { terms: 45, prior: 47, recent: 44, ar: 468_000 }, // Meridian Bank
  c14: { terms: 45, prior: 55, recent: 57, ar: 512_000 }, // Northgate
  c20: { terms: 60, prior: 71, recent: 74, ar: 587_000 }, // Pacific Crown
  c34: { terms: 30, prior: 39, recent: 36, ar: 187_000 }, // Grand Casa
  c02: { terms: 45, prior: 49, recent: 51, ar: 402_000 }, // Golden Lion
  c28: { terms: 30, prior: 33, recent: 31, ar: 154_000 }, // Velocity
};

export function paymentBehaviour(): PaymentBehaviourRow[] {
  const rows: PaymentBehaviourRow[] = [];
  for (const c of BOOK) {
    const p = PAY_BEHAVIOUR[c.id];
    if (!p) continue;
    rows.push({
      client: toRec(c),
      termsDays: p.terms,
      avgDaysPrior: p.prior,
      avgDaysRecent: p.recent,
      deltaDays: p.recent - p.prior,
      arOpen: p.ar,
    });
  }
  return rows.sort((a, b) => b.deltaDays - a.deltaDays);
}

// ── Cross-sell 滲透（集團獨有）───────────────────────────────────────────────

export interface CrossSellRow {
  name: string;
  sector: string;
  /** subsidiaryId → YTD 收入（0 = 冇幫襯） */
  revBySub: Record<number, number>;
  subCount: number;
  totalRev: number;
}

/** 每個品牌用緊集團幾多間公司。Production：以 customer 名／master brand
 *  對照表跨 subsidiary 合併（NetSuite 每間公司獨立 customer record）。 */
const CROSS_SELL: { name: string; sector: string; rev: [number, number, number, number, number] }[] = [
  //                                  [PB(1),  SSHK(2), CLS(5),  JM(7),   704(8)]
  { name: "Harbourview Retail 宏景零售", sector: "零售", rev: [0, 2_390_000, 0, 0, 420_000] },
  { name: "Meridian Bank 銘峰銀行", sector: "金融", rev: [380_000, 1_120_000, 0, 260_000, 0] },
  { name: "Pacific Crown Hotels 環冠酒店", sector: "酒店", rev: [0, 0, 0, 1_290_000, 510_000] },
  { name: "Lumina Bank 朗銀", sector: "金融", rev: [1_760_000, 0, 0, 0, 0] },
  { name: "Golden Lion F&B 金獅餐飲", sector: "餐飲", rev: [0, 1_405_000, 0, 0, 0] },
  { name: "Northgate Property 北港置業", sector: "地產", rev: [1_320_000, 0, 0, 0, 380_000] },
  { name: "Vertex Motors 域陞汽車", sector: "汽車", rev: [0, 638_000, 310_000, 0, 0] },
  { name: "Regal Jewellery 瑞閣珠寶", sector: "珠寶", rev: [0, 0, 0, 903_000, 0] },
  { name: "Vela Watches 星帆鐘錶", sector: "鐘錶", rev: [880_000, 0, 0, 0, 0] },
  { name: "Stellar Cruises 星輝郵輪", sector: "旅遊", rev: [0, 0, 0, 958_000, 0] },
  { name: "Velocity Auto Parts 迅達汽配", sector: "汽車", rev: [0, 0, 741_000, 0, 0] },
  { name: "Grand Casa Furnishing 尚居家品", sector: "家品", rev: [0, 0, 0, 0, 995_000] },
];

const CS_SUB_IDS = [1, 2, 5, 7, 8];

export function crossSell(): CrossSellRow[] {
  return CROSS_SELL.map((r) => {
    const revBySub: Record<number, number> = {};
    r.rev.forEach((v, i) => { revBySub[CS_SUB_IDS[i]] = v; });
    const subCount = r.rev.filter((v) => v > 0).length;
    const totalRev = r.rev.reduce((a, b) => a + b, 0);
    return { name: r.name, sector: r.sector, revBySub, subCount, totalRev };
  }).sort((a, b) => b.totalRev - a.totalRev);
}

// ── Elimination 完整性 ───────────────────────────────────────────────────────

export interface ElimPair {
  from: string;
  to: string;
  receivable: number;
  payable: number;
  /** receivable − payable；≠0 = interco 唔對數 */
  diff: number;
}

/** 每對公司嘅 interco 應收 vs 對方帳上應付 — 應該完全相等。
 *  Production：25xxx（Due From）對 35xxx（Due To）配對，每月自動檢查。
 *  Demo 個 4,870 差異對應 2026-08-06 真帳驗證發現嘅 0.08% aging gap。 */
export function eliminationCheck(): { pairs: ElimPair[]; totalDiff: number } {
  const pairs: ElimPair[] = [
    { from: "Social Strategy", to: "Photoblog", receivable: 2_580_000, payable: 2_575_130, diff: 4_870 },
    { from: "Photoblog", to: "Jervois M", receivable: 1_031_624, payable: 1_031_624, diff: 0 },
    { from: "Photoblog", to: "704 Production", receivable: 620_400, payable: 620_400, diff: 0 },
    { from: "Social Strategy", to: "CLS GARAGE", receivable: 312_500, payable: 312_500, diff: 0 },
    { from: "Photoblog", to: "CLS GARAGE", receivable: 188_700, payable: 188_700, diff: 0 },
  ];
  return { pairs, totalDiff: pairs.reduce((a, p) => a + Math.abs(p.diff), 0) };
}

// ── PB 中央成本回收率 ────────────────────────────────────────────────────────

/** Photoblog Admin/IT/Mgt 三個 pool 嘅成本 vs 收返嘅 management fee +
 *  reimbursement。<100% = PB 補貼緊成個集團（Mar25 真帳：pool 480K、
 *  收返 385K+67K，睇 docs/allocation-rules.md）。 */
export function pbRecoveryRate(): { month: number; pool: number; recovered: number; ratePct: number }[] {
  const POOL = [472_000, 466_000, 488_000, 494_000];
  const RECOVERED = [381_000, 392_000, 379_000, 402_000];
  return YTD.map((m) => ({
    month: m,
    pool: POOL[m - 1],
    recovered: RECOVERED[m - 1],
    ratePct: round1((100 * RECOVERED[m - 1]) / POOL[m - 1]),
  }));
}

// ── 貸款、淨負債、runway ─────────────────────────────────────────────────────

export interface Loan {
  bank: string;
  ref: string;
  subsidiaryId: number;
  balance: number;
  monthlyRepayment: number;
  ratePct: number;
  maturity: string;
}

/** 9 筆銀行貸款 — 結構跟真實 CoA 31xxx（Fubon/SCB/恒生×4/HSBC×2/OCBC）。 */
export function loanBook(): Loan[] {
  return [
    { bank: "Hang Seng", ref: "271-708638", subsidiaryId: 2, balance: 1_420_000, monthlyRepayment: 62_000, ratePct: 5.1, maturity: "2028-09" },
    { bank: "Hang Seng", ref: "271-805368", subsidiaryId: 2, balance: 1_180_000, monthlyRepayment: 54_000, ratePct: 5.4, maturity: "2028-03" },
    { bank: "HSBC", ref: "040-126393-165", subsidiaryId: 1, balance: 960_000, monthlyRepayment: 45_000, ratePct: 5.2, maturity: "2027-12" },
    { bank: "Hang Seng", ref: "271-824450", subsidiaryId: 2, balance: 720_000, monthlyRepayment: 38_000, ratePct: 5.6, maturity: "2027-08" },
    { bank: "OCBC", ref: "0830-370811", subsidiaryId: 2, balance: 690_000, monthlyRepayment: 31_000, ratePct: 4.9, maturity: "2028-06" },
    { bank: "Fubon", ref: "660-883822", subsidiaryId: 1, balance: 540_000, monthlyRepayment: 30_000, ratePct: 5.8, maturity: "2027-06" },
    { bank: "HSBC", ref: "040-126393-166", subsidiaryId: 1, balance: 460_000, monthlyRepayment: 24_000, ratePct: 5.2, maturity: "2027-10" },
    { bank: "SCB", ref: "51849461", subsidiaryId: 1, balance: 310_000, monthlyRepayment: 19_000, ratePct: 6.1, maturity: "2027-03" },
    { bank: "Hang Seng", ref: "997-006036", subsidiaryId: 2, balance: 265_000, monthlyRepayment: 15_000, ratePct: 5.5, maturity: "2027-05" },
  ];
}

/** 集團現金 vs 銀行負債逐月 — 淨現金一條線。 */
export function netDebtTrend(): { month: number; cash: number; debt: number; net: number }[] {
  const CASH = [7_690_000, 7_820_000, 7_950_000, 8_010_000];
  const DEBT = [7_030_000, 6_880_000, 6_730_000, 6_545_000];
  return YTD.map((m) => ({ month: m, cash: CASH[m - 1], debt: DEBT[m - 1], net: CASH[m - 1] - DEBT[m - 1] }));
}

export interface RunwayRow {
  subsidiaryId: number;
  cash: number;
  /** 近 3 個月平均每月現金淨流（−ve = 燒緊錢） */
  monthlyNet: number;
  /** null = 有錢賺，冇 runway 問題 */
  runwayMonths: number | null;
}

export function runwayBySub(): RunwayRow[] {
  return [
    { subsidiaryId: 1, cash: 2_157_000, monthlyNet: 85_000, runwayMonths: null },
    { subsidiaryId: 2, cash: 3_755_000, monthlyNet: 172_000, runwayMonths: null },
    { subsidiaryId: 5, cash: 731_000, monthlyNet: -48_000, runwayMonths: 15.2 },
    { subsidiaryId: 7, cash: 620_000, monthlyNet: 21_000, runwayMonths: null },
    { subsidiaryId: 8, cash: 748_000, monthlyNet: -96_000, runwayMonths: 7.8 },
  ];
}

// ── Retainer vs Project 收入 mix ─────────────────────────────────────────────

/** 收入穩定度：recurring（retainer）收入佔比逐月。
 *  Production：backlog coverage 同一份 retainer 合約清單，一份 input 兩個功能。 */
export function revenueMix(): { month: number; retainerRev: number; projectRev: number; retainerPct: number }[] {
  const RETAINER_SHARE = [0.58, 0.55, 0.53, 0.54];
  return YTD.map((m) => {
    const total = sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: ALL_SUB_IDS, months: [m], groups: REV_CODES });
    const retainerRev = Math.round(total * RETAINER_SHARE[m - 1]);
    return {
      month: m,
      retainerRev,
      projectRev: Math.round(total - retainerRev),
      retainerPct: round1(RETAINER_SHARE[m - 1] * 100),
    };
  });
}

// ── 數據完整度／遲入單（BvA 可信度）──────────────────────────────────────────

export interface EntryLagRow {
  subsidiaryId: number;
  /** 供應商單：transaction date → 入系統平均日數 */
  avgLagBillDays: number;
  /** 供應商單遲 >60 日比例（%） */
  billsOver60Pct: number;
}

/** ⚠️ 呢啲係真實統計 — 2026-08-07 喺 live NetSuite 度量
 *  （FY2025/26 起 VendBill 嘅 createddate − trandate）。唔係 demo 數。 */
export function entryLag(): { rows: EntryLagRow[]; invoiceAvgDays: number; journalAvgDays: number } {
  return {
    rows: [
      { subsidiaryId: 8, avgLagBillDays: 55.9, billsOver60Pct: 29.2 },
      { subsidiaryId: 2, avgLagBillDays: 43.7, billsOver60Pct: 23.9 },
      { subsidiaryId: 5, avgLagBillDays: 43.6, billsOver60Pct: 22.8 },
      { subsidiaryId: 1, avgLagBillDays: 27.7, billsOver60Pct: 10.8 },
      { subsidiaryId: 7, avgLagBillDays: 24.9, billsOver60Pct: 5.2 },
    ],
    invoiceAvgDays: 22.8,
    journalAvgDays: 39.6,
  };
}

export interface CompletenessRow {
  month: number;
  /** 估計成本數據已入齊幾多 %（由歷史 lag 曲線推算） */
  estCompletePct: number;
  status: "final" | "partial";
}

/** 每月成本數據成熟度 — 近兩個月睇 BvA 要留意「使少咗」可能只係未入單。
 *  Production：用該公司歷史 lag 分佈推算（IBNR 式 completion factor）。 */
export function completeness(): CompletenessRow[] {
  return [
    { month: 1, estCompletePct: 98, status: "final" },
    { month: 2, estCompletePct: 95, status: "final" },
    { month: 3, estCompletePct: 86, status: "partial" },
    { month: 4, estCompletePct: 68, status: "partial" },
  ];
}
