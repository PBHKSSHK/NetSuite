// Shared domain types — mirrors the Supabase schema in /supabase/migrations
// (dim_subsidiary / dim_department / report_group / fact_gl …).
// When the real sync lands, DataSource implementations swap the demo module
// for Supabase reads without touching page code.

export interface Subsidiary {
  /** NetSuite subsidiary internal id */
  id: number;
  name: string;
  short: string;
  isElimination: boolean;
  /** minimum-cash alert floor, HKD (config table in production) */
  cashFloor: number;
}

export interface Department {
  /** NetSuite department internal id (real ids for 6/9/11, demo ids otherwise) */
  id: number;
  name: string;
  nameZh: string;
  isAllocatable: boolean;
}

export type Statement = "PL" | "BS";

export type PLSection =
  | "REVENUE"
  | "COS"
  | "OPEX"
  | "OTHER_INCOME";

export interface ReportGroup {
  code: string;
  label: string;
  labelZh: string;
  statement: Statement;
  section: string;
  sortOrder: number;
  /** +1 = income-natured (credit positive), -1 = expense-natured */
  sign: 1 | -1;
}

/** One monthly amount for (fy, subsidiary, report_group). Amounts are HKD,
 *  already sign-normalised: revenue positive, costs positive. */
export interface MonthlyFact {
  fyLabel: string;
  subsidiaryId: number;
  groupCode: string;
  /** FY month number, 1 = April … 12 = March */
  month: number;
  kind: "actual" | "budget";
  amount: number;
}

export interface OpenItem {
  txnId: string;
  subsidiaryId: number;
  entityName: string;
  tranDate: string; // ISO
  dueDate: string; // ISO
  amountOpen: number;
}

export interface BankPoint {
  date: string; // ISO
  subsidiaryId: number;
  balance: number;
}

export interface PayrollRow {
  subsidiaryId: number;
  departmentId: number;
  month: number; // FY month of current FY
  headcount: number;
  basicSalary: number;
  mpfEr: number;
  totalCost: number;
}

export interface RecurringCashItem {
  subsidiaryId: number;
  label: string;
  direction: "in" | "out";
  amount: number;
  dayOfMonth: number;
}

export type PeriodMode = "month" | "quarter" | "ytd";

export interface PeriodSelection {
  mode: PeriodMode;
  /** FY month 1–12 (for month mode: that month; quarter: quarter containing it) */
  month: number;
}
