import type { Department, ReportGroup, Subsidiary } from "./types";

// ── Subsidiaries (NetSuite internal ids — verified in blueprint §0.1) ──────────

export const SUBSIDIARIES: Subsidiary[] = [
  { id: 1, name: "Photoblog.hk Limited", short: "Photoblog", isElimination: false, cashFloor: 1_500_000 },
  { id: 2, name: "Social Strategy Hong Kong Limited", short: "Social Strategy", isElimination: false, cashFloor: 2_000_000 },
  { id: 5, name: "CLS GARAGE", short: "CLS GARAGE", isElimination: false, cashFloor: 800_000 },
  { id: 7, name: "Jervois M Limited", short: "Jervois M", isElimination: false, cashFloor: 1_000_000 },
  { id: 8, name: "704 Production Limited", short: "704 Production", isElimination: false, cashFloor: 600_000 },
  { id: 4, name: "Elimination", short: "Elimination", isElimination: true, cashFloor: 0 },
];

/** Operating subsidiaries (excludes Elimination). */
export const OPERATING_SUBS = SUBSIDIARIES.filter((s) => !s.isElimination);

export const CONSOLIDATED_ID = -1; // NetSuite consolidated view id

export function subsidiaryById(id: number): Subsidiary | undefined {
  return SUBSIDIARIES.find((s) => s.id === id);
}

// ── Departments (15 active per data audit §1.2; ids 6/9/11 are real) ──────────

export const DEPARTMENTS: Department[] = [
  { id: 9, name: "Management", nameZh: "管理層", isAllocatable: true },
  { id: 6, name: "Admin Finance HR", nameZh: "行政/財務/人事", isAllocatable: true },
  { id: 11, name: "IT", nameZh: "IT", isAllocatable: true },
  { id: 101, name: "Editorial", nameZh: "編輯部", isAllocatable: false },
  { id: 102, name: "Production", nameZh: "製作部", isAllocatable: false },
  { id: 103, name: "Account Servicing", nameZh: "客戶服務", isAllocatable: false },
  { id: 104, name: "Monitoring and Seeding", nameZh: "Monitoring & Seeding", isAllocatable: false },
  { id: 105, name: "Sales", nameZh: "營業部", isAllocatable: false },
  { id: 106, name: "ePR Team", nameZh: "ePR Team", isAllocatable: false },
  { id: 107, name: "Commercial Team", nameZh: "Commercial Team", isAllocatable: false },
  { id: 108, name: "Creative Team", nameZh: "Creative Team", isAllocatable: false },
  { id: 109, name: "JM Team", nameZh: "JM Team", isAllocatable: false },
  { id: 110, name: "JS Sales Team", nameZh: "JS Sales Team", isAllocatable: false },
  { id: 111, name: "Travel Agency", nameZh: "旅遊部", isAllocatable: false },
  { id: 112, name: "Pro Health", nameZh: "Pro Health", isAllocatable: false },
];

export const UNTAGGED_DEPT_ID = 0;

export function departmentById(id: number): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

// ── Report groups (P&L rows per blueprint §5.1, BS rows per §5.2) ─────────────
// In production the account → report_group mapping lives in Supabase and is
// maintained by the accountant in the admin UI (§10.5: never hardcode).

export const PL_GROUPS: ReportGroup[] = [
  { code: "REV_SERVICE", label: "Service Fee Income", labelZh: "服務費收入（60xx）", statement: "PL", section: "REVENUE", sortOrder: 10, sign: 1 },
  { code: "REV_TRAVEL", label: "Travel Service Income", labelZh: "旅遊服務收入（61xx）", statement: "PL", section: "REVENUE", sortOrder: 20, sign: 1 },
  { code: "REV_GOODS", label: "Sales of Goods", labelZh: "商品銷售（62xx）", statement: "PL", section: "REVENUE", sortOrder: 30, sign: 1 },
  { code: "COS_SERVICES", label: "Cost of Services", labelZh: "服務成本（含媒體投放）", statement: "PL", section: "COS", sortOrder: 40, sign: -1 },
  { code: "COS_GOODS", label: "Cost of Goods Sold", labelZh: "商品銷售成本", statement: "PL", section: "COS", sortOrder: 50, sign: -1 },
  { code: "OPEX_STAFF", label: "Staff Costs", labelZh: "員工成本（薪金+MPF）", statement: "PL", section: "OPEX", sortOrder: 60, sign: -1 },
  { code: "OPEX_RENT", label: "Rent & Utilities", labelZh: "租金及水電", statement: "PL", section: "OPEX", sortOrder: 70, sign: -1 },
  { code: "OPEX_DEPRECIATION", label: "Depreciation", labelZh: "折舊", statement: "PL", section: "OPEX", sortOrder: 80, sign: -1 },
  { code: "OPEX_ADMIN", label: "Admin & Professional", labelZh: "行政及專業費用", statement: "PL", section: "OPEX", sortOrder: 90, sign: -1 },
  { code: "OPEX_IT", label: "IT & Software", labelZh: "IT 及軟件", statement: "PL", section: "OPEX", sortOrder: 100, sign: -1 },
  { code: "OPEX_MARKETING", label: "Marketing", labelZh: "市場推廣", statement: "PL", section: "OPEX", sortOrder: 110, sign: -1 },
  { code: "OPEX_OTHER", label: "Other Opex", labelZh: "其他營運開支", statement: "PL", section: "OPEX", sortOrder: 120, sign: -1 },
  { code: "OTHER_INCOME", label: "Other Income", labelZh: "其他收入（64xx）", statement: "PL", section: "OTHER_INCOME", sortOrder: 130, sign: 1 },
  { code: "ASSOC_INCOME", label: "Share of Associates", labelZh: "聯營公司股息/收益", statement: "PL", section: "OTHER_INCOME", sortOrder: 140, sign: 1 },
];

export const BS_GROUPS: ReportGroup[] = [
  { code: "BS_CASH", label: "Cash & Bank", labelZh: "銀行及現金", statement: "BS", section: "CURRENT_ASSETS", sortOrder: 10, sign: 1 },
  { code: "BS_AR", label: "Trade Receivables", labelZh: "應收帳款", statement: "BS", section: "CURRENT_ASSETS", sortOrder: 20, sign: 1 },
  { code: "BS_OTHER_CA", label: "Deposits & Prepayments", labelZh: "按金及預付款", statement: "BS", section: "CURRENT_ASSETS", sortOrder: 30, sign: 1 },
  { code: "BS_FA", label: "Fixed Assets (net)", labelZh: "固定資產（淨值）", statement: "BS", section: "NON_CURRENT_ASSETS", sortOrder: 40, sign: 1 },
  { code: "BS_INV_ASSOC", label: "Investment in Associates", labelZh: "聯營公司投資", statement: "BS", section: "NON_CURRENT_ASSETS", sortOrder: 50, sign: 1 },
  { code: "BS_AP", label: "Trade Payables", labelZh: "應付帳款", statement: "BS", section: "CURRENT_LIABILITIES", sortOrder: 60, sign: -1 },
  { code: "BS_ACCRUALS", label: "Accruals & Other Payables", labelZh: "應計及其他應付款", statement: "BS", section: "CURRENT_LIABILITIES", sortOrder: 70, sign: -1 },
  { code: "BS_TAX", label: "Tax Payable", labelZh: "應付稅項", statement: "BS", section: "CURRENT_LIABILITIES", sortOrder: 80, sign: -1 },
  { code: "BS_SHARE_CAP", label: "Share Capital", labelZh: "股本", statement: "BS", section: "EQUITY", sortOrder: 90, sign: -1 },
  { code: "BS_RETAINED", label: "Retained Earnings", labelZh: "保留盈利", statement: "BS", section: "EQUITY", sortOrder: 100, sign: -1 },
];

export const BS_SECTION_LABELS: Record<string, string> = {
  CURRENT_ASSETS: "流動資產",
  NON_CURRENT_ASSETS: "非流動資產",
  CURRENT_LIABILITIES: "流動負債",
  EQUITY: "權益",
};

export function plGroup(code: string): ReportGroup {
  const g = PL_GROUPS.find((x) => x.code === code);
  if (!g) throw new Error(`unknown PL group ${code}`);
  return g;
}
