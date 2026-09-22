// ─────────────────────────────────────────────────────────────────────────────
// BU P&L / Cashflow 還原引擎（Blueprint v0.1 §2）。
//  1. 每條 fact_bu_pl 行 → ic_flag（§2.2 步驟 2）+ bu_code（bu_mapping）+ mgmt_line
//  2. Layer 1：EXTERNAL 行按 BU 歸集（pass-through 自動抵銷）
//  3. Layer 2：SHARED pool 按 allocation key 分攤落 4 個 BU
//  4. Bridge：法定（per company）→ 剔 IC → BU 純業務 → 分攤後
//  5. BU cash contribution（§2.3 A）
// 所有規則來自 Supabase reference tables（bu-store.ts），唔 hard-code。
// ─────────────────────────────────────────────────────────────────────────────

import {
  ACCOUNTS,
  ACCOUNT_OVERRIDE,
  ALLOC_RULES,
  ALLOC_TXN,
  BU_CASH,
  BU_MAPPING,
  BU_PL,
  DEPT_NAMES,
  DIRECTOR_ALLOC,
  GP_SHARE,
  HEADCOUNT,
  IC_ACCOUNTS,
  IC_BALANCES,
  IC_ENTITIES,
  RECLASS_RULES,
  TAX_SAVING,
} from "./bu-store";

// ── BU / 行次定義 ────────────────────────────────────────────────────────────

export type BuCode = "EPR" | "PROD" | "JM" | "CLS" | "SHARED" | "OTHER";

export const BU_LIST: { code: BuCode; label: string; en: string }[] = [
  { code: "EPR", label: "ePR", en: "ePR" },
  { code: "PROD", label: "Production", en: "Production" },
  { code: "JM", label: "JM", en: "Jervois M" },
  { code: "CLS", label: "CLS", en: "CLS Garage" },
  { code: "SHARED", label: "PB 平台（待分攤）", en: "PB-Platform / Shared" },
  { code: "OTHER", label: "其他", en: "Other" },
];
export const CORE_BUS: BuCode[] = ["EPR", "PROD", "JM", "CLS"];
export const BU_ORDER: BuCode[] = ["EPR", "PROD", "JM", "CLS", "SHARED", "OTHER"];

export function buLabel(code: string): string {
  return BU_LIST.find((b) => b.code === code)?.label ?? code;
}

export type IcFlag = "EXTERNAL" | "IC_MGMT_FEE" | "IC_INVOICE" | "IC_BILL" | "IC_JOURNAL_OTHER";
export const IC_FLAG_LABEL: Record<IcFlag, string> = {
  EXTERNAL: "外部",
  IC_MGMT_FEE: "IC management fee",
  IC_INVOICE: "IC 借名開單（invoice）",
  IC_BILL: "IC recharge（vendor bill）",
  IC_JOURNAL_OTHER: "IC 分攤 journal（Share of expenses / DN 開單）",
};

export type MgmtLine =
  | "REVENUE"
  | "DIRECT_COST"
  | "STAFF"
  | "RENT"
  | "MARKETING"
  | "ADMIN"
  | "DEPRECIATION"
  | "OTHER_INCOME"
  | "FINANCE"
  | "OTHER_EXPENSE"
  | "TAX"
  | "IC_MGMT_FEE";

export const MGMT_LINE_LABEL: Record<MgmtLine, string> = {
  REVENUE: "收入 Revenue",
  DIRECT_COST: "直接成本 Direct cost",
  STAFF: "人工 Staff",
  RENT: "租金及物業 Rent",
  MARKETING: "市場推廣 Marketing",
  ADMIN: "行政及其他 Admin & other",
  DEPRECIATION: "折舊 Depreciation",
  OTHER_INCOME: "其他收入 Other income",
  FINANCE: "財務費用 Finance",
  OTHER_EXPENSE: "其他支出 / 匯兌 Other",
  TAX: "稅項 Tax",
  IC_MGMT_FEE: "IC management fee（法定帳）",
};

const OPEX_LINES: MgmtLine[] = ["STAFF", "RENT", "MARKETING", "ADMIN"];

// ── 期間 ─────────────────────────────────────────────────────────────────────

/** 'YYYY-MM' → 財年（4 月起）label + FY 月份（1 = 4 月） */
export function fyOf(ym: string): { fy: string; fm: number; startYear: number } {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const startYear = m >= 4 ? y : y - 1;
  return { fy: `FY${startYear}/${String(startYear + 1).slice(2)}`, fm: m >= 4 ? m - 3 : m + 9, startYear };
}

export function ymOf(fy: string, fm: number): string {
  const startYear = Number(fy.slice(2, 6));
  const m0 = 3 + (fm - 1);
  const year = startYear + Math.floor(m0 / 12);
  const month = (m0 % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function priorFy(fy: string): string {
  const s = Number(fy.slice(2, 6)) - 1;
  return `FY${s}/${String(s + 1).slice(2)}`;
}

export const FM_LABEL = ["4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月"];

export interface Period {
  fy: string;
  months: number[]; // FY months 1–12
}

// ── 行分類 ───────────────────────────────────────────────────────────────────

export interface Line {
  ym: string;
  fy: string;
  fm: number;
  sub: number;
  dept: number;
  acct: number;
  ttype: string;
  icFlag: IcFlag;
  icEntity: number;
  /** 對手方 subsidiary（IC 行）*/
  counterparty: number | null;
  /** related-party（Go Asia / Jervois T / X）——保留為外部但可標示 */
  related: boolean;
  bu: BuCode;
  mgmtLine: MgmtLine;
  /** credit − debit：收入正、成本負（HKD） */
  amount: number;
  lines: number;
}

/** account 層級 reclass（bu_reclass_rules）優先於 bu_mapping */
function reclassFor(sub: number, dept: number, ym: string, acctnumber: string): BuCode | null {
  const date = `${ym}-15`;
  for (const r of RECLASS_RULES) {
    if (r.subsidiaryId !== sub) continue;
    if (r.departmentId != null && r.departmentId !== dept) continue;
    if (r.effectiveFrom > date) continue;
    if (r.effectiveTo && r.effectiveTo < date) continue;
    if (r.acctPrefixes && !r.acctPrefixes.some((p) => acctnumber.startsWith(p))) continue;
    return r.buCode as BuCode;
  }
  return null;
}

function buFor(sub: number, dept: number, ym: string, acctnumber = ""): BuCode {
  const reclass = acctnumber ? reclassFor(sub, dept, ym, acctnumber) : null;
  if (reclass) return reclass;
  const date = `${ym}-15`;
  let fallback: BuCode | null = null;
  for (const m of BU_MAPPING) {
    if (m.subsidiaryId !== sub) continue;
    if (m.effectiveFrom > date) continue;
    if (m.effectiveTo && m.effectiveTo < date) continue;
    if (m.departmentId === dept) return m.buCode as BuCode;
    if (m.departmentId == null && !fallback) fallback = m.buCode as BuCode;
  }
  return fallback ?? "OTHER";
}

const RG_TO_LINE: Record<string, MgmtLine> = {
  REV_SERVICE: "REVENUE",
  REV_TRAVEL: "REVENUE",
  REV_GOODS: "REVENUE",
  COS_SERVICES: "DIRECT_COST",
  COS_GOODS: "DIRECT_COST",
  OPEX_STAFF: "STAFF",
  OPEX_RENT: "RENT",
  OPEX_MARKETING: "MARKETING",
  OPEX_ADMIN: "ADMIN",
  OPEX_IT: "ADMIN",
  OPEX_OTHER: "ADMIN",
  OPEX_DEPRECIATION: "DEPRECIATION",
  OTHER_INCOME: "OTHER_INCOME",
  ASSOC_INCOME: "OTHER_INCOME",
};

export function mgmtLineFor(acct: number): MgmtLine {
  const ic = IC_ACCOUNTS.get(acct);
  if (ic?.icType === "MGMT_FEE") return "IC_MGMT_FEE";
  const override = ACCOUNT_OVERRIDE.get(acct);
  if (override) return override as MgmtLine;
  const a = ACCOUNTS.get(acct);
  const no = a?.acctnumber ?? "";
  if (no.startsWith("93")) return "TAX";
  if (no.startsWith("85")) return "FINANCE";
  if (no.startsWith("83")) return "OTHER_EXPENSE";
  if (a?.reportGroupCode && RG_TO_LINE[a.reportGroupCode]) return RG_TO_LINE[a.reportGroupCode];
  switch (a?.accttype) {
    case "Income":
      return "REVENUE";
    case "COGS":
      return "DIRECT_COST";
    case "OthIncome":
      return "OTHER_INCOME";
    case "OthExpense":
      return "OTHER_EXPENSE";
    default:
      return "ADMIN";
  }
}

function classify(row: (typeof BU_PL)[number]): { icFlag: IcFlag; counterparty: number | null; related: boolean } {
  const ic = IC_ACCOUNTS.get(row.accountId);
  if (ic?.icType === "MGMT_FEE") return { icFlag: "IC_MGMT_FEE", counterparty: null, related: false };
  const ent = row.icEntityId ? IC_ENTITIES.get(row.icEntityId) : undefined;
  if (ent) {
    const isInv = row.txnType === "CustInvc" || row.txnType === "CustCred";
    const isBill = row.txnType === "VendBill" || row.txnType === "VendCred";
    if (ent.relation === "group") {
      if (isInv) return { icFlag: "IC_INVOICE", counterparty: ent.counterpartySubsidiaryId, related: false };
      if (isBill) return { icFlag: "IC_BILL", counterparty: ent.counterpartySubsidiaryId, related: false };
    } else {
      return { icFlag: "EXTERNAL", counterparty: null, related: true };
    }
  }
  if (row.txnType === "Journal" && row.icJournal) return { icFlag: "IC_JOURNAL_OTHER", counterparty: null, related: false };
  return { icFlag: "EXTERNAL", counterparty: null, related: false };
}

let cache: { key: number; lines: Line[] } | null = null;

export function allLines(): Line[] {
  const key = BU_PL.length * 31 + BU_MAPPING.length * 7 + RECLASS_RULES.length;
  if (cache && cache.key === key) return cache.lines;
  const lines: Line[] = BU_PL.map((r) => {
    const { fy, fm } = fyOf(r.ym);
    const c = classify(r);
    return {
      ym: r.ym,
      fy,
      fm,
      sub: r.subsidiaryId,
      dept: r.departmentId,
      acct: r.accountId,
      ttype: r.txnType,
      icFlag: c.icFlag,
      icEntity: r.icEntityId,
      counterparty: c.counterparty,
      related: c.related,
      bu: buFor(r.subsidiaryId, r.departmentId, r.ym, ACCOUNTS.get(r.accountId)?.acctnumber ?? ""),
      mgmtLine: mgmtLineFor(r.accountId),
      amount: r.credit - r.debit,
      lines: r.lines,
    };
  });
  cache = { key, lines };
  return lines;
}

export function availableFys(): string[] {
  const set = new Set<string>();
  for (const r of BU_PL) set.add(fyOf(r.ym).fy);
  return [...set].sort();
}

/** 該財年最後一個有數據的 FY 月份 */
export function lastMonthWithData(fy: string): number {
  let max = 0;
  for (const r of BU_PL) {
    const f = fyOf(r.ym);
    if (f.fy === fy && f.fm > max) max = f.fm;
  }
  return max || 12;
}

export function linesIn(p: Period, extra?: (l: Line) => boolean): Line[] {
  const ms = new Set(p.months);
  return allLines().filter((l) => l.fy === p.fy && ms.has(l.fm) && (!extra || extra(l)));
}

export function periodLabelOf(p: Period): string {
  if (p.months.length === 12) return `${p.fy} 全年`;
  if (p.months.length === 1) return `${p.fy} ${FM_LABEL[p.months[0] - 1]}`;
  return `${p.fy} ${FM_LABEL[p.months[0] - 1]}–${FM_LABEL[p.months[p.months.length - 1] - 1]}`;
}

// ── P&L 矩陣 ─────────────────────────────────────────────────────────────────

export interface PlColumn {
  lines: Record<MgmtLine, number>;
  allocation: number; // Layer 2 平台成本分攤（負 = 承擔成本）
  directorAlloc: number; // Layer 2 老闆人工（BU 報表口徑；負 = 承擔）
  revenue: number;
  directCost: number;
  gp: number;
  opex: number;
  ebitda: number; // 純業務 EBITDA（Layer 1）
  ebitdaAlloc: number; // 分攤後
  np: number;
  npAlloc: number;
}

function emptyCol(): PlColumn {
  const lines = Object.fromEntries(Object.keys(MGMT_LINE_LABEL).map((k) => [k, 0])) as Record<MgmtLine, number>;
  return { lines, allocation: 0, directorAlloc: 0, revenue: 0, directCost: 0, gp: 0, opex: 0, ebitda: 0, ebitdaAlloc: 0, np: 0, npAlloc: 0 };
}

function finalize(c: PlColumn): PlColumn {
  c.revenue = c.lines.REVENUE;
  c.directCost = c.lines.DIRECT_COST;
  c.gp = c.revenue + c.directCost;
  c.opex = OPEX_LINES.reduce((a, k) => a + c.lines[k], 0);
  c.ebitda = c.gp + c.opex + c.lines.IC_MGMT_FEE;
  c.ebitdaAlloc = c.ebitda + c.allocation + c.directorAlloc;
  const below = c.lines.DEPRECIATION + c.lines.OTHER_INCOME + c.lines.FINANCE + c.lines.OTHER_EXPENSE + c.lines.TAX;
  c.np = c.ebitda + below;
  c.npAlloc = c.np + c.allocation + c.directorAlloc;
  return c;
}

export type AllocKey = "workbook" | "headcount" | "gp_share" | "revenue_share" | "fixed_pct";

/** 會計 worksheet 欄 → BU（PBHK Youtube 喺 NetSuite 同 Production 同一 dept，併入 Production） */
export const WS_TO_BU: Record<string, BuCode | "ASSOC"> = {
  PROD_PB: "PROD",
  PROD_704: "PROD",
  YT: "PROD",
  EPR: "EPR",
  EPR_COMM: "EPR",
  CLS: "CLS",
  JM: "JM",
  ASSOC_JS: "ASSOC",
  ASSOC_GOASIA: "ASSOC",
};
export const WS_LABEL: Record<string, string> = {
  PROD_PB: "PBHK Production",
  YT: "PBHK Youtube",
  PROD_704: "704 Production",
  EPR: "SSHK ePR",
  EPR_COMM: "SSHK Comm",
  CLS: "CLS",
  JM: "JM",
  ASSOC_JS: "JS",
  ASSOC_GOASIA: "Go Asia",
};

export type PoolCode = "ADMIN" | "IT" | "MGT";
export const POOL_DEPT: Record<PoolCode, number> = { ADMIN: 6, IT: 11, MGT: 9 };
export const POOL_LABEL: Record<PoolCode, string> = { ADMIN: "Admin, Finance, HR", IT: "IT Department", MGT: "Management" };

export interface PoolResult {
  /** 外部淨成本（含該 dept 外部收入抵減；Mgt 已扣老闆人工 ledger） */
  gross: number;
  /** Go Asia / JS 人頭份額（只 Admin / IT） */
  assocB: number;
  net: number;
  byLine: Record<MgmtLine, number>;
}

export interface DirectorResult {
  byBu: Record<BuCode, number>;
  /** worksheet 各 BU 合計 */
  sheetTotal: number;
  /** 帳面 Directors Remunerations + MPF（PBHK Management dept） */
  ledgerTotal: number;
  variance: number;
}

export interface AllocationResult {
  key: AllocKey;
  label: string;
  /** SHARED 純業務淨成本（正數 = 成本） */
  grossPool: number;
  /** 向 Go Asia / JS 收取的外部 admin fee（正數），抵減 pool */
  assocFee: number;
  pool: number;
  basis: Record<BuCode, number>;
  share: Record<BuCode, number>;
  amount: Record<BuCode, number>; // 正數 = 該 BU 承擔
  basisLabel: string;
  headcountYm?: string;
  pools: Record<PoolCode, PoolResult>;
  director: DirectorResult;
}

const DIRECTOR_ACCT = "81000039";
const MPF_ACCT = "81000063";

/** 最近一個 ≤ ym 嘅月份（reference tables 沿用最近一次輸入） */
function latestYm(yms: Iterable<string>, ym: string): string | undefined {
  let best: string | undefined;
  for (const y of yms) if (y <= ym && (!best || y > best)) best = y;
  return best;
}

/** worksheet GP%（月）→ BU 份額（0–1），YT / Comm 併入對應 BU */
export function gpShareFor(ym: string): { share: Record<BuCode, number>; ym?: string; raw: { code: string; pct: number }[] } {
  const share = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  const src = latestYm(new Set(GP_SHARE.map((g) => g.ym)), ym);
  const raw: { code: string; pct: number }[] = [];
  let total = 0;
  for (const g of GP_SHARE) {
    if (g.ym !== src) continue;
    raw.push({ code: g.buCode, pct: g.pct });
    const bu = WS_TO_BU[g.buCode];
    if (bu && bu !== "ASSOC") {
      share[bu] += g.pct;
      total += g.pct;
    }
  }
  if (total) for (const b of BU_ORDER) share[b] /= total;
  return { share, ym: src, raw };
}

/** worksheet headcount（月）：BU 人頭 + associates（JS / Go Asia）人頭 */
export function headcountFor(ym: string): { byBu: Record<BuCode, number>; assoc: number; total: number; ym?: string; raw: { code: string; hc: number }[] } {
  const byBu = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  const src = latestYm(new Set(HEADCOUNT.map((h) => h.ym)), ym);
  const raw: { code: string; hc: number }[] = [];
  let assoc = 0;
  let total = 0;
  for (const h of HEADCOUNT) {
    if (h.ym !== src) continue;
    raw.push({ code: h.buCode, hc: h.headcount });
    const bu = WS_TO_BU[h.buCode] ?? (CORE_BUS.includes(h.buCode as BuCode) ? (h.buCode as BuCode) : "ASSOC");
    if (bu === "ASSOC") assoc += h.headcount;
    else byBu[bu] += h.headcount;
    total += h.headcount;
  }
  return { byBu, assoc, total, ym: src, raw };
}

/** 老闆人工（BU 報表口徑，worksheet「director」）— 期間合計 */
export function directorFor(p: Period): DirectorResult {
  const yms = new Set(p.months.map((m) => ymOf(p.fy, m)));
  const byBu = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  let sheetTotal = 0;
  const ledgerByYm = new Map<string, number>();
  for (const d of DIRECTOR_ALLOC) {
    if (!yms.has(d.ym)) continue;
    const bu = WS_TO_BU[d.buCode];
    if (bu && bu !== "ASSOC") byBu[bu] += d.amount;
    sheetTotal += d.amount;
    ledgerByYm.set(d.ym, d.ledgerSalary + d.ledgerMpf);
  }
  const ledgerTotal = [...ledgerByYm.values()].reduce((a, b) => a + b, 0);
  return { byBu, sheetTotal, ledgerTotal, variance: sheetTotal - ledgerTotal };
}

/** SHARED pools（PBHK Admin / IT / Management 外部淨成本），Mgt 扣除老闆人工 ledger（另按 director sheet 分） */
export function sharedPools(p: Period): { pools: Record<PoolCode, PoolResult>; directorLedgerInPool: number } {
  const pools = Object.fromEntries((Object.keys(POOL_DEPT) as PoolCode[]).map((k) => [k, { gross: 0, assocB: 0, net: 0, byLine: emptyCol().lines }])) as Record<PoolCode, PoolResult>;
  let directorLedger = 0;
  // 逐月：Admin / IT 扣 associates 人頭份額
  for (const m of p.months) {
    const ym = ymOf(p.fy, m);
    const hc = headcountFor(ym);
    const assocShare = hc.total ? hc.assoc / hc.total : 0;
    const monthGross: Record<PoolCode, number> = { ADMIN: 0, IT: 0, MGT: 0 };
    for (const l of linesIn({ fy: p.fy, months: [m] }, (l) => l.bu === "SHARED" && l.icFlag === "EXTERNAL" && l.sub === 1)) {
      const pool = (Object.keys(POOL_DEPT) as PoolCode[]).find((k) => POOL_DEPT[k] === l.dept);
      if (!pool) continue;
      const no = ACCOUNTS.get(l.acct)?.acctnumber ?? "";
      if (pool === "MGT" && (no === DIRECTOR_ACCT || no === MPF_ACCT)) {
        // 老闆人工 + MPF：唔入 pool，由 director sheet 直接分落 BU
        const ledger = -l.amount;
        directorLedger += ledger;
        continue;
      }
      pools[pool].byLine[l.mgmtLine] += l.amount;
      monthGross[pool] += -l.amount;
    }
    for (const k of Object.keys(POOL_DEPT) as PoolCode[]) {
      pools[k].gross += monthGross[k];
      if (k !== "MGT") pools[k].assocB += monthGross[k] * assocShare;
    }
  }
  for (const k of Object.keys(POOL_DEPT) as PoolCode[]) pools[k].net = pools[k].gross - pools[k].assocB;
  return { pools, directorLedgerInPool: directorLedger };
}

/** 向後相容：SHARED pool 合計（gross / associates 份額 / net）*/
export function sharedPool(p: Period, netAssocFee = true): { gross: number; assocFee: number; net: number; byLine: Record<MgmtLine, number>; byDept: { dept: number; name: string; amount: number }[] } {
  const { pools } = sharedPools(p);
  const byLine = emptyCol().lines;
  const byDept: { dept: number; name: string; amount: number }[] = [];
  let gross = 0;
  let assocB = 0;
  for (const k of Object.keys(POOL_DEPT) as PoolCode[]) {
    gross += pools[k].gross;
    assocB += pools[k].assocB;
    for (const ln of Object.keys(byLine) as MgmtLine[]) byLine[ln] += pools[k].byLine[ln];
    byDept.push({ dept: POOL_DEPT[k], name: POOL_LABEL[k], amount: pools[k].gross });
  }
  const assocFee = netAssocFee ? assocB : 0;
  return { gross, assocFee, net: gross - assocFee, byLine, byDept: byDept.sort((a, b) => b.amount - a.amount) };
}

/** PB 60000022 Management Fee Income − 各 NetSuite 子公司 81000059/68 費用 = 實際向 associates（Go Asia / JS）收的 admin fee */
export function associatesAdminFee(p: Period): number {
  let pbIncome = 0;
  let subExpense = 0;
  for (const l of linesIn(p, (l) => l.icFlag === "IC_MGMT_FEE" && l.mgmtLine === "IC_MGMT_FEE")) {
    if (l.sub === 1) pbIncome += l.amount;
    else subExpense += -l.amount;
  }
  return Math.round(pbIncome - subExpense);
}

export function allocationFor(p: Period, key: AllocKey, netAssocFee = true): AllocationResult {
  const rule = ALLOC_RULES.find((r) => r.keyType === key);
  const { pools } = sharedPools(p);
  const director = directorFor(p);
  const basis = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  const share = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  const amount = Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>;
  let basisLabel = "";
  let headcountYm: string | undefined;
  const grossPool = pools.ADMIN.gross + pools.IT.gross + pools.MGT.gross;
  const assocB = pools.ADMIN.assocB + pools.IT.assocB;
  const netPool = netAssocFee ? grossPool - assocB : grossPool;

  if (key === "workbook") {
    // 逐月：(Admin − B) + (IT − B) + Mgt 按當月 GP% 分
    for (const m of p.months) {
      const ym = ymOf(p.fy, m);
      const { pools: mp } = sharedPools({ fy: p.fy, months: [m] });
      const gs = gpShareFor(ym);
      const poolM = (netAssocFee ? mp.ADMIN.net + mp.IT.net : mp.ADMIN.gross + mp.IT.gross) + mp.MGT.gross;
      for (const b of CORE_BUS) {
        amount[b] += poolM * gs.share[b];
        basis[b] += gs.share[b] * 100;
      }
    }
    const total = CORE_BUS.reduce((a, b) => a + basis[b], 0) || 1;
    for (const b of CORE_BUS) {
      share[b] = basis[b] / total;
      amount[b] = Math.round(amount[b]);
    }
    basisLabel = `worksheet GP%（${gpShareFor(ymOf(p.fy, p.months[p.months.length - 1])).ym ?? "—"}）`;
    headcountYm = headcountFor(ymOf(p.fy, p.months[p.months.length - 1])).ym;
  } else {
    if (key === "headcount") {
      const lastYm = ymOf(p.fy, p.months[p.months.length - 1]);
      const hc = headcountFor(lastYm);
      headcountYm = hc.ym;
      for (const b of CORE_BUS) basis[b] = hc.byBu[b];
      basisLabel = `人頭（${hc.ym ?? "未有紀錄"}）`;
    } else if (key === "gp_share" || key === "revenue_share") {
      const m = plByBu(p, 1);
      for (const b of CORE_BUS) basis[b] = Math.max(0, key === "gp_share" ? m[b].gp : m[b].revenue);
      basisLabel = key === "gp_share" ? "本期純業務 GP" : "本期純業務收入";
    } else {
      for (const b of CORE_BUS) basis[b] = Number(rule?.params?.[b] ?? 0);
      basisLabel = "固定比例（allocation_rules.params）";
    }
    const total = CORE_BUS.reduce((a, b) => a + basis[b], 0) || 1;
    for (const b of CORE_BUS) {
      share[b] = basis[b] / total;
      amount[b] = Math.round(netPool * share[b]);
    }
  }
  return {
    key,
    label: rule?.label ?? key,
    grossPool,
    assocFee: netAssocFee ? assocB : 0,
    pool: netPool,
    basis,
    share,
    amount,
    basisLabel,
    headcountYm,
    pools,
    director,
  };
}

/** 管理帳 P&L：每個 BU 一欄（Layer 1 = 純業務；Layer 2 加分攤） */
export function plByBu(p: Period, layer: 1 | 2, key: AllocKey = "headcount", netAssocFee = true): Record<BuCode, PlColumn> & { TOTAL: PlColumn } {
  const cols = Object.fromEntries(BU_ORDER.map((b) => [b, emptyCol()])) as Record<BuCode, PlColumn>;
  const total = emptyCol();
  for (const l of linesIn(p, (l) => l.icFlag === "EXTERNAL")) {
    cols[l.bu].lines[l.mgmtLine] += l.amount;
    total.lines[l.mgmtLine] += l.amount;
  }
  if (layer === 2) {
    const a = allocationFor(p, key, netAssocFee);
    let shared = 0;
    let director = 0;
    for (const b of CORE_BUS) {
      cols[b].allocation = -a.amount[b];
      cols[b].directorAlloc = -a.director.byBu[b];
      shared += a.amount[b];
      director += a.director.byBu[b];
    }
    // SHARED 釋出：pool（淨）+ 老闆人工（worksheet 口徑）；差額 = associates 人頭份額 + 老闆人工分攤差異
    cols.SHARED.allocation = shared;
    cols.SHARED.directorAlloc = director;
  }
  for (const b of BU_ORDER) finalize(cols[b]);
  finalize(total);
  total.allocation = BU_ORDER.reduce((a, b) => a + cols[b].allocation, 0);
  total.directorAlloc = BU_ORDER.reduce((a, b) => a + cols[b].directorAlloc, 0);
  total.ebitdaAlloc = total.ebitda + total.allocation + total.directorAlloc;
  total.npAlloc = total.np + total.allocation + total.directorAlloc;
  return { ...cols, TOTAL: total };
}

/** 法定 P&L：每間公司一欄（含 IC 行） */
export function plBySub(p: Period): { subs: number[]; cols: Record<number, PlColumn>; total: PlColumn } {
  const cols: Record<number, PlColumn> = {};
  const total = emptyCol();
  for (const l of linesIn(p)) {
    (cols[l.sub] ??= emptyCol()).lines[l.mgmtLine] += l.amount;
    total.lines[l.mgmtLine] += l.amount;
  }
  const subs = Object.keys(cols).map(Number).sort((a, b) => a - b);
  for (const s of subs) finalize(cols[s]);
  finalize(total);
  return { subs, cols, total };
}

// ── Bridge（§2.2 步驟 5）──────────────────────────────────────────────────────

export interface BridgeSubRow {
  sub: number;
  legalNp: number;
  icMgmtFee: number;
  icInvoice: number;
  icBill: number;
  icJournal: number;
  externalNp: number;
  byBu: Record<BuCode, number>;
}

export function bridge(p: Period, key: AllocKey, netAssocFee = true) {
  const rows = new Map<number, BridgeSubRow>();
  const blank = (sub: number): BridgeSubRow => ({
    sub,
    legalNp: 0,
    icMgmtFee: 0,
    icInvoice: 0,
    icBill: 0,
    icJournal: 0,
    externalNp: 0,
    byBu: Object.fromEntries(BU_ORDER.map((b) => [b, 0])) as Record<BuCode, number>,
  });
  for (const l of linesIn(p)) {
    const r = rows.get(l.sub) ?? blank(l.sub);
    r.legalNp += l.amount;
    switch (l.icFlag) {
      case "IC_MGMT_FEE":
        r.icMgmtFee += l.amount;
        break;
      case "IC_INVOICE":
        r.icInvoice += l.amount;
        break;
      case "IC_BILL":
        r.icBill += l.amount;
        break;
      case "IC_JOURNAL_OTHER":
        r.icJournal += l.amount;
        break;
      default:
        r.externalNp += l.amount;
        r.byBu[l.bu] += l.amount;
    }
    rows.set(l.sub, r);
  }
  const subRows = [...rows.values()].sort((a, b) => a.sub - b.sub);
  const sum = (f: (r: BridgeSubRow) => number) => subRows.reduce((a, r) => a + f(r), 0);
  const alloc = allocationFor(p, key, netAssocFee);
  const layer1 = Object.fromEntries(BU_ORDER.map((b) => [b, sum((r) => r.byBu[b])])) as Record<BuCode, number>;
  const released = CORE_BUS.reduce((a, b) => a + alloc.amount[b] + alloc.director.byBu[b], 0);
  const layer2 = Object.fromEntries(BU_ORDER.map((b) => [b, layer1[b] + (b === "SHARED" ? released : CORE_BUS.includes(b) ? -(alloc.amount[b] + alloc.director.byBu[b]) : 0)])) as Record<BuCode, number>;
  return {
    subRows,
    totals: {
      legalNp: sum((r) => r.legalNp),
      icMgmtFee: sum((r) => r.icMgmtFee),
      icInvoice: sum((r) => r.icInvoice),
      icBill: sum((r) => r.icBill),
      icJournal: sum((r) => r.icJournal),
      externalNp: sum((r) => r.externalNp),
    },
    layer1,
    layer2,
    alloc,
    check: Math.round(sum((r) => r.externalNp) - BU_ORDER.reduce((a, b) => a + layer1[b], 0)),
  };
}

// ── Trend ────────────────────────────────────────────────────────────────────

export type Metric = "REV" | "GP" | "EBITDA" | "NP";

export function buMonthly(fy: string, bu: BuCode | "TOTAL", metric: Metric, layer: 1 | 2, key: AllocKey = "headcount"): (number | null)[] {
  const last = lastMonthWithData(fy);
  const out: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    if (m > last) {
      out.push(null);
      continue;
    }
    const cols = plByBu({ fy, months: [m] }, layer, key);
    const c = cols[bu];
    const v = metric === "REV" ? c.revenue : metric === "GP" ? c.gp : metric === "EBITDA" ? (layer === 2 ? c.ebitdaAlloc : c.ebitda) : layer === 2 ? c.npAlloc : c.np;
    out.push(Math.round(v));
  }
  return out;
}

// ── Drill-down（BU → 公司/department → account）─────────────────────────────

export interface DrillDept {
  sub: number;
  dept: number;
  deptName: string;
  revenue: number;
  directCost: number;
  opex: number;
  other: number;
  np: number;
  accounts: { acct: number; acctnumber: string; name: string; mgmtLine: MgmtLine; amount: number; lines: number }[];
}

export function drill(p: Period, bu: BuCode): DrillDept[] {
  const map = new Map<string, DrillDept>();
  for (const l of linesIn(p, (l) => l.bu === bu && l.icFlag === "EXTERNAL")) {
    const k = `${l.sub}|${l.dept}`;
    let d = map.get(k);
    if (!d) {
      d = { sub: l.sub, dept: l.dept, deptName: DEPT_NAMES.get(l.dept) ?? `#${l.dept}`, revenue: 0, directCost: 0, opex: 0, other: 0, np: 0, accounts: [] };
      map.set(k, d);
    }
    if (l.mgmtLine === "REVENUE") d.revenue += l.amount;
    else if (l.mgmtLine === "DIRECT_COST") d.directCost += l.amount;
    else if (OPEX_LINES.includes(l.mgmtLine)) d.opex += l.amount;
    else d.other += l.amount;
    d.np += l.amount;
    const a = ACCOUNTS.get(l.acct);
    let acc = d.accounts.find((x) => x.acct === l.acct);
    if (!acc) {
      acc = { acct: l.acct, acctnumber: a?.acctnumber ?? "", name: a?.fullname ?? `#${l.acct}`, mgmtLine: l.mgmtLine, amount: 0, lines: 0 };
      d.accounts.push(acc);
    }
    acc.amount += l.amount;
    acc.lines += l.lines;
  }
  const out = [...map.values()].sort((a, b) => Math.abs(b.np) - Math.abs(a.np) || b.revenue - a.revenue);
  for (const d of out) d.accounts.sort((x, y) => x.acctnumber.localeCompare(y.acctnumber));
  return out;
}

// ── BU cash contribution（§2.3 A）────────────────────────────────────────────

export interface BuCashRow {
  bu: BuCode;
  extIn: number;
  extOut: number;
  icIn: number;
  icOut: number;
  net: number;
}

export function buCash(p: Period): { rows: BuCashRow[]; total: BuCashRow; hasData: boolean } {
  const ms = new Set(p.months.map((m) => ymOf(p.fy, m)));
  const map = new Map<BuCode, BuCashRow>();
  for (const b of BU_ORDER) map.set(b, { bu: b, extIn: 0, extOut: 0, icIn: 0, icOut: 0, net: 0 });
  let hasData = false;
  for (const c of BU_CASH) {
    if (!ms.has(c.ym)) continue;
    hasData = true;
    const bu = buFor(c.subsidiaryId, c.departmentId, c.ym);
    const r = map.get(bu)!;
    const ent = c.icEntityId ? IC_ENTITIES.get(c.icEntityId) : undefined;
    const isIc = ent?.relation === "group";
    if (c.direction === "in") {
      if (isIc) r.icIn += c.amount;
      else r.extIn += c.amount;
    } else if (isIc) r.icOut += c.amount;
    else r.extOut += c.amount;
  }
  const rows = BU_ORDER.map((b) => map.get(b)!);
  for (const r of rows) r.net = r.extIn - r.extOut;
  const total: BuCashRow = { bu: "OTHER", extIn: 0, extOut: 0, icIn: 0, icOut: 0, net: 0 };
  for (const r of rows) {
    total.extIn += r.extIn;
    total.extOut += r.extOut;
    total.icIn += r.icIn;
    total.icOut += r.icOut;
    total.net += r.net;
  }
  return { rows, total, hasData };
}

export function buCashMonthly(fy: string): { fm: number; ym: string; byBu: Record<BuCode, number>; extIn: number; extOut: number }[] {
  const out: { fm: number; ym: string; byBu: Record<BuCode, number>; extIn: number; extOut: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = buCash({ fy, months: [m] });
    if (!r.hasData) continue;
    out.push({ fm: m, ym: ymOf(fy, m), byBu: Object.fromEntries(r.rows.map((x) => [x.bu, Math.round(x.net)])) as Record<BuCode, number>, extIn: r.total.extIn, extOut: r.total.extOut });
  }
  return out;
}

/** 月份範圍內有 cash 數據嘅 FY 列表 */
export function cashFys(): string[] {
  return [...new Set(BU_CASH.map((c) => fyOf(c.ym).fy))].sort();
}

// ── Inter-co 配對 / 結欠 ─────────────────────────────────────────────────────

export interface IcPair {
  from: number; // 開單公司
  to: number; // 對手方
  invoiced: number; // from 向 to 開 invoice（收入）
  billed: number; // to 入 from 的 vendor bill（成本）
  diff: number;
}

/** 借名開單追蹤：A 向 B 開的 IC invoice vs B 入 A 的 IC bill（§5.5） */
export function icPairs(p: Period): IcPair[] {
  const map = new Map<string, IcPair>();
  const get = (from: number, to: number) => {
    const k = `${from}|${to}`;
    let r = map.get(k);
    if (!r) {
      r = { from, to, invoiced: 0, billed: 0, diff: 0 };
      map.set(k, r);
    }
    return r;
  };
  for (const l of linesIn(p, (l) => l.icFlag === "IC_INVOICE" || l.icFlag === "IC_BILL")) {
    if (l.counterparty == null) continue;
    if (l.icFlag === "IC_INVOICE") get(l.sub, l.counterparty).invoiced += l.amount;
    else get(l.counterparty, l.sub).billed += -l.amount;
  }
  const out = [...map.values()];
  for (const r of out) r.diff = r.invoiced - r.billed;
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

export function mgmtFeeCheck(p: Period): { pbIncome: number; bySub: { sub: number; expense: number }[]; subTotal: number; assoc: number } {
  let pbIncome = 0;
  const bySub = new Map<number, number>();
  for (const l of linesIn(p, (l) => l.icFlag === "IC_MGMT_FEE")) {
    if (l.sub === 1) pbIncome += l.amount;
    else bySub.set(l.sub, (bySub.get(l.sub) ?? 0) + -l.amount);
  }
  const rows = [...bySub.entries()].map(([sub, expense]) => ({ sub, expense })).sort((a, b) => a.sub - b.sub);
  const subTotal = rows.reduce((a, r) => a + r.expense, 0);
  return { pbIncome, bySub: rows, subTotal, assoc: pbIncome - subTotal };
}

// ── 年結 tax planning（tax_saving_adjustments）對數 ──────────────────────────

export interface TaxSavingCheckRow {
  sub: number;
  /** worksheet：正 = 開單方收入、負 = 被扣方 */
  sheet: number;
  /** 本系統剔除嘅 IC invoice / bill / journal 淨額（收入正、成本負） */
  eliminated: number;
  diff: number;
}

export function taxSavingRows(fy: string): { fy: string; nature: string; sub: number; amount: number }[] {
  return TAX_SAVING.filter((t) => t.fy === fy).map((t) => ({ fy: t.fy, nature: t.nature, sub: t.subsidiaryId, amount: t.amount }));
}

export function taxSavingFys(): string[] {
  return [...new Set(TAX_SAVING.map((t) => t.fy))].sort();
}

/** worksheet 年結 IC 開單 vs 本系統全年剔除嘅 IC（invoice + bill + 分攤 journal，mgmt fee 除外） */
export function taxSavingCheck(fy: string): TaxSavingCheckRow[] {
  const full: Period = { fy, months: Array.from({ length: 12 }, (_, i) => i + 1) };
  const sheet = new Map<number, number>();
  for (const t of TAX_SAVING) if (t.fy === fy) sheet.set(t.subsidiaryId, (sheet.get(t.subsidiaryId) ?? 0) + t.amount);
  const elim = new Map<number, number>();
  for (const l of linesIn(full, (l) => l.icFlag === "IC_INVOICE" || l.icFlag === "IC_BILL" || l.icFlag === "IC_JOURNAL_OTHER")) {
    elim.set(l.sub, (elim.get(l.sub) ?? 0) + l.amount);
  }
  const subs = [...new Set([...sheet.keys(), ...elim.keys()])].sort((a, b) => a - b);
  return subs.map((sub) => {
    const s = sheet.get(sub) ?? 0;
    const e = elim.get(sub) ?? 0;
    return { sub, sheet: s, eliminated: e, diff: e - s };
  });
}

// ── 會計「BU gross profit share」workbook：NetSuite 實際分攤 vs BU 還原 ─────────

export type AllocCategory = "SHARE_ADMIN" | "SHARE_IT" | "SHARE_MGT" | "MGMT_FEE" | "DN_PROPERTY" | "DN_ADVERTISING" | "IC_INVOICE_BILL" | "DN_OTHER";
export const ALLOC_CATEGORY_LABEL: Record<AllocCategory, string> = {
  SHARE_ADMIN: "Share of Admin / Finance / HR",
  SHARE_IT: "Share of IT",
  SHARE_MGT: "Share of Management",
  MGMT_FEE: "Management fee",
  DN_PROPERTY: "DN：租金 / 大廈管理費",
  DN_ADVERTISING: "DN：廣告費",
  IC_INVOICE_BILL: "IC invoice / bill（tax planning）",
  DN_OTHER: "其他 DN",
};
/** GP% 分攤機制嘅類別（同 Layer 2 還原分攤可比） */
export const GP_SHARE_CATEGORIES: AllocCategory[] = ["SHARE_ADMIN", "SHARE_IT", "SHARE_MGT", "MGMT_FEE"];
export const ALLOC_CATEGORIES: AllocCategory[] = [...GP_SHARE_CATEGORIES, "DN_PROPERTY", "DN_ADVERTISING", "IC_INVOICE_BILL", "DN_OTHER"];

/** workbook 分頁公司 → BU（SS→EPR、704→PROD、CLS→CLS、JM→JM；PB = 平台側） */
const LEDGER_SUB_TO_BU: Record<number, BuCode> = { 2: "EPR", 8: "PROD", 5: "CLS", 7: "JM" };

function inPeriod(ym: string, p: Period): boolean {
  const { fy, fm } = fyOf(ym);
  return fy === p.fy && p.months.includes(fm);
}

export interface NsAllocRow {
  bu: BuCode;
  sub: number;
  /** 各類別：子公司帳上淨費用（debit − credit，正 = 成本） */
  byCat: Record<AllocCategory, number>;
  /** GP% 機制合計（SHARE_* + MGMT_FEE） */
  gpShare: number;
  /** 本系統 Layer 2 還原分攤（pool C + 老闆人工），正 = 成本 */
  restored: number;
  diff: number;
}

/**
 * NetSuite 實際按 GP% 分攤去各公司（alloc_txn_ledger 子公司側）vs 本系統還原分攤。
 * PB 側（subsidiary 1）為 credit，另外回傳 pbSide 供對稱檢查。
 */
export function nsAllocation(p: Period, key: AllocKey, netAssocFee = true): { rows: NsAllocRow[]; total: NsAllocRow; pbSide: Record<AllocCategory, number>; hasData: boolean } {
  const empty = (): Record<AllocCategory, number> => Object.fromEntries(ALLOC_CATEGORIES.map((c) => [c, 0])) as Record<AllocCategory, number>;
  const byBu = new Map<BuCode, Record<AllocCategory, number>>();
  const pbSide = empty();
  let hasData = false;
  for (const r of ALLOC_TXN) {
    if (!inPeriod(r.ym, p)) continue;
    const cat = (ALLOC_CATEGORIES.includes(r.category as AllocCategory) ? r.category : "DN_OTHER") as AllocCategory;
    hasData = true;
    if (r.subsidiaryId === 1) {
      pbSide[cat] += r.credit - r.debit; // PB 側收入 / 費用抵減（正）
      continue;
    }
    const bu = LEDGER_SUB_TO_BU[r.subsidiaryId];
    if (!bu) continue;
    if (!byBu.has(bu)) byBu.set(bu, empty());
    byBu.get(bu)![cat] += r.debit - r.credit;
  }
  const alloc = allocationFor(p, key, netAssocFee);
  const rows: NsAllocRow[] = CORE_BUS.map((bu) => {
    const byCat = byBu.get(bu) ?? empty();
    const gpShare = GP_SHARE_CATEGORIES.reduce((a, c) => a + byCat[c], 0);
    const restored = alloc.amount[bu] + alloc.director.byBu[bu];
    const sub = Number(Object.keys(LEDGER_SUB_TO_BU).find((k) => LEDGER_SUB_TO_BU[Number(k)] === bu));
    return { bu, sub, byCat, gpShare, restored, diff: gpShare - restored };
  });
  const total: NsAllocRow = {
    bu: "SHARED",
    sub: 0,
    byCat: ALLOC_CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: rows.reduce((a, r) => a + r.byCat[c], 0) }), empty()),
    gpShare: rows.reduce((a, r) => a + r.gpShare, 0),
    restored: rows.reduce((a, r) => a + r.restored, 0),
    diff: 0,
  };
  total.diff = total.gpShare - total.restored;
  return { rows, total, pbSide, hasData };
}

export interface LedgerCoverageRow {
  sub: number;
  /** workbook 淨額（debit − credit） */
  ledger: number;
  /** 本系統 IC 剔除行（ic_flag ≠ EXTERNAL）同 (月, account) 淨額（debit − credit） */
  facts: number;
  diff: number;
  /** 有差異（|diff| ≥ 1）嘅 (月, account) 格數 */
  cells: number;
  worst: { ym: string; acct: string; ledger: number; facts: number }[];
}

/**
 * 會計分攤清單覆蓋：workbook 每個 (公司, 月, account) 淨額 vs 本系統 IC 剔除行。
 * 只比較 fact 有數據嘅月份；差異 = 未識別 IC entity / journal 規則漏網 / workbook 未列。
 */
export function ledgerCoverage(p: Period): LedgerCoverageRow[] {
  const ledger = new Map<string, number>();
  for (const r of ALLOC_TXN) {
    if (!inPeriod(r.ym, p)) continue;
    const k = `${r.subsidiaryId}|${r.ym}|${r.acctNumber}`;
    ledger.set(k, (ledger.get(k) ?? 0) + r.debit - r.credit);
  }
  const facts = new Map<string, number>();
  for (const l of linesIn(p, (l) => l.icFlag !== "EXTERNAL")) {
    const acct = ACCOUNTS.get(l.acct)?.acctnumber ?? String(l.acct);
    const k = `${l.sub}|${l.ym}|${acct}`;
    facts.set(k, (facts.get(k) ?? 0) + -l.amount);
  }
  const subs = [...new Set([...ledger.keys(), ...facts.keys()].map((k) => Number(k.split("|")[0])))].sort((a, b) => a - b);
  return subs.map((sub) => {
    const keys = [...new Set([...ledger.keys(), ...facts.keys()].filter((k) => k.startsWith(`${sub}|`)))];
    let lt = 0;
    let ft = 0;
    const diffs: { ym: string; acct: string; ledger: number; facts: number }[] = [];
    for (const k of keys) {
      const lv = ledger.get(k) ?? 0;
      const fv = facts.get(k) ?? 0;
      lt += lv;
      ft += fv;
      if (Math.abs(lv - fv) >= 1) {
        const [, ym, acct] = k.split("|");
        diffs.push({ ym, acct, ledger: lv, facts: fv });
      }
    }
    diffs.sort((a, b) => Math.abs(b.ledger - b.facts) - Math.abs(a.ledger - a.facts));
    return { sub, ledger: lt, facts: ft, diff: ft - lt, cells: diffs.length, worst: diffs.slice(0, 5) };
  });
}

export function ledgerFys(): string[] {
  return [...new Set(ALLOC_TXN.map((r) => fyOf(r.ym).fy))].sort();
}

export interface IcBalance {
  sub: number;
  acct: number;
  acctnumber: string;
  name: string;
  net: number; // 正 = 應收（Due From）、負 = 應付（Due To）
  asOf: string;
}

/** 截至最後 sync 的 inter-co 結欠（fact_gl 累計） */
export function icBalances(): IcBalance[] {
  const map = new Map<string, IcBalance>();
  let asOf = "";
  for (const r of IC_BALANCES) {
    if (r.ym > asOf) asOf = r.ym;
    const k = `${r.subsidiaryId}|${r.accountId}`;
    let b = map.get(k);
    if (!b) {
      const a = ACCOUNTS.get(r.accountId);
      b = { sub: r.subsidiaryId, acct: r.accountId, acctnumber: a?.acctnumber ?? "", name: a?.fullname ?? `#${r.accountId}`, net: 0, asOf: "" };
      map.set(k, b);
    }
    b.net += r.net;
  }
  const out = [...map.values()].filter((b) => Math.abs(b.net) >= 1);
  for (const b of out) b.asOf = asOf;
  return out.sort((a, b) => a.sub - b.sub || Math.abs(b.net) - Math.abs(a.net));
}

// ── Data quality（§5.8）──────────────────────────────────────────────────────

export interface UntaggedRow {
  sub: number;
  amount: number; // 絕對值合計
  lines: number;
  totalAbs: number;
  pct: number;
}

export function untaggedBySub(p: Period): UntaggedRow[] {
  const map = new Map<number, UntaggedRow>();
  for (const l of linesIn(p)) {
    const r = map.get(l.sub) ?? { sub: l.sub, amount: 0, lines: 0, totalAbs: 0, pct: 0 };
    const abs = Math.abs(l.amount);
    r.totalAbs += abs;
    if (l.dept === 0) {
      r.amount += abs;
      r.lines += l.lines;
    }
    map.set(l.sub, r);
  }
  const out = [...map.values()].sort((a, b) => a.sub - b.sub);
  for (const r of out) r.pct = r.totalAbs ? r.amount / r.totalAbs : 0;
  return out;
}

export function untaggedByFy(): { fy: string; bySub: Record<number, number> }[] {
  const out: { fy: string; bySub: Record<number, number> }[] = [];
  for (const fy of availableFys()) {
    const rows = untaggedBySub({ fy, months: Array.from({ length: 12 }, (_, i) => i + 1) });
    out.push({ fy, bySub: Object.fromEntries(rows.map((r) => [r.sub, r.pct])) });
  }
  return out;
}

/** 借名開單線：同一公司 × department 收入 ≈ 直接成本（§1.3 觀察） */
export function passThroughLines(p: Period): { sub: number; dept: number; deptName: string; revenue: number; directCost: number; icShare: number }[] {
  const map = new Map<string, { sub: number; dept: number; deptName: string; revenue: number; directCost: number; icAbs: number; totalAbs: number }>();
  for (const l of linesIn(p, (l) => l.mgmtLine === "REVENUE" || l.mgmtLine === "DIRECT_COST")) {
    const k = `${l.sub}|${l.dept}`;
    const r = map.get(k) ?? { sub: l.sub, dept: l.dept, deptName: DEPT_NAMES.get(l.dept) ?? `#${l.dept}`, revenue: 0, directCost: 0, icAbs: 0, totalAbs: 0 };
    if (l.mgmtLine === "REVENUE") r.revenue += l.amount;
    else r.directCost += -l.amount;
    r.totalAbs += Math.abs(l.amount);
    if (l.icFlag !== "EXTERNAL") r.icAbs += Math.abs(l.amount);
    map.set(k, r);
  }
  return [...map.values()]
    .filter((r) => r.revenue > 0 && r.directCost > 0 && Math.abs(r.revenue - r.directCost) / Math.max(r.revenue, r.directCost) < 0.15)
    .map((r) => ({ sub: r.sub, dept: r.dept, deptName: r.deptName, revenue: r.revenue, directCost: r.directCost, icShare: r.totalAbs ? r.icAbs / r.totalAbs : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** 未在 bu_mapping 明確列出（靠公司預設）嘅 department 使用量 */
export function mappingCoverage(p: Period): { sub: number; dept: number; deptName: string; bu: BuCode; explicit: boolean; amountAbs: number }[] {
  const map = new Map<string, { sub: number; dept: number; deptName: string; bu: BuCode; explicit: boolean; amountAbs: number }>();
  for (const l of linesIn(p, (l) => l.icFlag === "EXTERNAL")) {
    const k = `${l.sub}|${l.dept}`;
    let r = map.get(k);
    if (!r) {
      const explicit = BU_MAPPING.some((m) => m.subsidiaryId === l.sub && m.departmentId === l.dept);
      r = { sub: l.sub, dept: l.dept, deptName: DEPT_NAMES.get(l.dept) ?? `#${l.dept}`, bu: l.bu, explicit, amountAbs: 0 };
      map.set(k, r);
    }
    r.amountAbs += Math.abs(l.amount);
  }
  return [...map.values()].sort((a, b) => a.sub - b.sub || b.amountAbs - a.amountAbs);
}

export function icFlagSummary(p: Period): { flag: IcFlag; income: number; cost: number; lines: number }[] {
  const map = new Map<IcFlag, { flag: IcFlag; income: number; cost: number; lines: number }>();
  for (const l of linesIn(p)) {
    const r = map.get(l.icFlag) ?? { flag: l.icFlag, income: 0, cost: 0, lines: 0 };
    if (l.amount >= 0) r.income += l.amount;
    else r.cost += -l.amount;
    r.lines += l.lines;
    map.set(l.icFlag, r);
  }
  const order: IcFlag[] = ["EXTERNAL", "IC_MGMT_FEE", "IC_INVOICE", "IC_BILL", "IC_JOURNAL_OTHER"];
  return order.filter((f) => map.has(f)).map((f) => map.get(f)!);
}
