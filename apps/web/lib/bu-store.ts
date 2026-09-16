// ─────────────────────────────────────────────────────────────────────────────
// BU 還原數據層（Blueprint v0.1 §3）。
// hydrateBu() 由 Supabase 讀 fact_bu_pl / fact_bu_cash + reference tables
// （bu_mapping、ic_entity_map、ic_account_map、allocation_rules、
// headcount_monthly、account_group_map）+ dim_account / dim_department，
// 砌成 in-memory stores；lib/bu.ts 引擎全部由呢度讀數。
// 所有表 RLS 要登入先讀到（DataBoot 把關）。
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "./supabase";

export interface BuPlRow {
  ym: string;
  subsidiaryId: number;
  departmentId: number;
  accountId: number;
  txnType: string;
  icEntityId: number;
  icJournal: boolean;
  debit: number;
  credit: number;
  lines: number;
}

export interface BuCashRow {
  ym: string;
  subsidiaryId: number;
  departmentId: number;
  direction: "in" | "out";
  icEntityId: number;
  amount: number;
  payments: number;
}

export interface BuMappingRow {
  subsidiaryId: number;
  departmentId: number | null;
  buCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
}

export interface IcEntityRow {
  entityId: number;
  entityType: "customer" | "vendor";
  counterpartySubsidiaryId: number | null;
  relation: "group" | "related_external";
  name: string | null;
}

export interface IcAccountRow {
  accountId: number;
  acctnumber: string | null;
  icType: "MGMT_FEE" | "IC_BALANCE";
}

export interface AllocationRule {
  ruleId: number;
  costPool: string;
  keyType: "headcount" | "gp_share" | "revenue_share" | "fixed_pct";
  label: string;
  params: Record<string, number>;
  isDefault: boolean;
}

export interface HeadcountRow {
  ym: string;
  buCode: string;
  headcount: number;
  source: string | null;
}

export interface AccountInfo {
  id: number;
  acctnumber: string | null;
  fullname: string;
  accttype: string | null;
  reportGroupCode: string | null;
}

export interface IcBalanceRow {
  /** dim_period start_date（YYYY-MM-DD）→ 用嚟 cut as-of */
  ym: string;
  subsidiaryId: number;
  accountId: number;
  net: number; // debit − credit
}

export const BU_PL: BuPlRow[] = [];
export const BU_CASH: BuCashRow[] = [];
export const BU_MAPPING: BuMappingRow[] = [];
export const IC_ENTITIES = new Map<number, IcEntityRow>();
export const IC_ACCOUNTS = new Map<number, IcAccountRow>();
export const ALLOC_RULES: AllocationRule[] = [];
export const HEADCOUNT: HeadcountRow[] = [];
export const ACCOUNT_OVERRIDE = new Map<number, string>();
export const ACCOUNTS = new Map<number, AccountInfo>();
export const DEPT_NAMES = new Map<number, string>();
export const IC_BALANCES: IcBalanceRow[] = [];
export const BU_META = { loaded: false, maxYm: "", minYm: "", rows: 0 };

const PAGE = 1000;

async function fetchAll<T>(table: string, columns: string, order: string[], filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns);
    if (filter) q = filter(q);
    for (const c of order) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`讀取 ${table} 失敗：${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

let promise: Promise<void> | null = null;

export function hydrateBu(): Promise<void> {
  if (!promise) {
    promise = doHydrate().catch((e) => {
      promise = null;
      throw e;
    });
  }
  return promise;
}

async function doHydrate(): Promise<void> {
  const [pl, cash, mapping, icEnt, icAcc, rules, hc, overrides, accounts, groups, depts, periods] = await Promise.all([
    fetchAll<any>(
      "fact_bu_pl",
      "ym, subsidiary_id, department_id, account_id, txn_type, ic_entity_id, ic_journal, debit, credit, lines",
      ["ym", "subsidiary_id", "department_id", "account_id", "txn_type", "ic_entity_id", "ic_journal"]
    ),
    fetchAll<any>("fact_bu_cash", "ym, subsidiary_id, department_id, direction, ic_entity_id, amount, payments", [
      "ym",
      "subsidiary_id",
      "department_id",
      "direction",
      "ic_entity_id",
    ]),
    fetchAll<any>("bu_mapping", "subsidiary_id, department_id, bu_code, effective_from, effective_to, note", ["id"]),
    fetchAll<any>("ic_entity_map", "entity_id, entity_type, counterparty_subsidiary_id, relation, name", ["entity_id"]),
    fetchAll<any>("ic_account_map", "account_id, acctnumber, ic_type", ["account_id"]),
    fetchAll<any>("allocation_rules", "rule_id, cost_pool, key_type, label, params, is_default", ["rule_id"]),
    fetchAll<any>("headcount_monthly", "ym, bu_code, headcount, source", ["ym", "bu_code"]),
    fetchAll<any>("account_group_map", "account_id, mgmt_line", ["account_id"]),
    fetchAll<any>("dim_account", "id, acctnumber, fullname, accttype, report_group_id", ["id"]),
    fetchAll<any>("report_group", "id, code", ["id"]),
    fetchAll<any>("dim_department", "id, name", ["id"]),
    fetchAll<any>("dim_period", "id, start_date", ["id"]),
  ]);

  // inter-co 結欠（fact_gl 內 250000xx / 35002xxx 帳戶；fact_gl 由每日 sync 維護）
  const icBalanceIds = icAcc.filter((r: any) => r.ic_type === "IC_BALANCE").map((r: any) => r.account_id);
  const periodStart = new Map<number, string>(periods.map((p: any) => [p.id, String(p.start_date).slice(0, 7)]));
  const icGl = icBalanceIds.length
    ? await fetchAll<any>("fact_gl", "period_id, subsidiary_id, account_id, debit, credit", ["period_id", "subsidiary_id", "account_id"], (q) =>
        q.in("account_id", icBalanceIds)
      )
    : [];

  const groupCode = new Map<number, string>(groups.map((g: any) => [g.id, g.code]));

  BU_PL.length = 0;
  let minYm = "9999-99";
  let maxYm = "";
  for (const r of pl) {
    BU_PL.push({
      ym: r.ym,
      subsidiaryId: r.subsidiary_id,
      departmentId: r.department_id,
      accountId: r.account_id,
      txnType: r.txn_type,
      icEntityId: r.ic_entity_id,
      icJournal: !!r.ic_journal,
      debit: num(r.debit),
      credit: num(r.credit),
      lines: num(r.lines),
    });
    if (r.ym < minYm) minYm = r.ym;
    if (r.ym > maxYm) maxYm = r.ym;
  }

  BU_CASH.length = 0;
  for (const r of cash) {
    BU_CASH.push({
      ym: r.ym,
      subsidiaryId: r.subsidiary_id,
      departmentId: r.department_id,
      direction: r.direction,
      icEntityId: r.ic_entity_id,
      amount: num(r.amount),
      payments: num(r.payments),
    });
  }

  BU_MAPPING.length = 0;
  for (const r of mapping) {
    BU_MAPPING.push({
      subsidiaryId: r.subsidiary_id,
      departmentId: r.department_id,
      buCode: r.bu_code,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      note: r.note,
    });
  }

  IC_ENTITIES.clear();
  for (const r of icEnt) {
    IC_ENTITIES.set(r.entity_id, {
      entityId: r.entity_id,
      entityType: r.entity_type,
      counterpartySubsidiaryId: r.counterparty_subsidiary_id,
      relation: r.relation,
      name: r.name,
    });
  }

  IC_ACCOUNTS.clear();
  for (const r of icAcc) {
    IC_ACCOUNTS.set(r.account_id, { accountId: r.account_id, acctnumber: r.acctnumber, icType: r.ic_type });
  }

  ALLOC_RULES.length = 0;
  for (const r of rules) {
    ALLOC_RULES.push({
      ruleId: r.rule_id,
      costPool: r.cost_pool,
      keyType: r.key_type,
      label: r.label,
      params: (r.params ?? {}) as Record<string, number>,
      isDefault: !!r.is_default,
    });
  }

  HEADCOUNT.length = 0;
  for (const r of hc) HEADCOUNT.push({ ym: r.ym, buCode: r.bu_code, headcount: num(r.headcount), source: r.source });

  ACCOUNT_OVERRIDE.clear();
  for (const r of overrides) ACCOUNT_OVERRIDE.set(r.account_id, r.mgmt_line);

  ACCOUNTS.clear();
  for (const a of accounts) {
    ACCOUNTS.set(a.id, {
      id: a.id,
      acctnumber: a.acctnumber,
      fullname: a.fullname ?? `Account #${a.id}`,
      accttype: a.accttype,
      reportGroupCode: a.report_group_id != null ? groupCode.get(a.report_group_id) ?? null : null,
    });
  }

  DEPT_NAMES.clear();
  for (const d of depts) DEPT_NAMES.set(d.id, d.name);
  if (!DEPT_NAMES.has(0)) DEPT_NAMES.set(0, "未標 department");

  IC_BALANCES.length = 0;
  for (const r of icGl) {
    IC_BALANCES.push({
      ym: periodStart.get(r.period_id) ?? "",
      subsidiaryId: r.subsidiary_id,
      accountId: r.account_id,
      net: num(r.debit) - num(r.credit),
    });
  }

  BU_META.loaded = true;
  BU_META.rows = BU_PL.length;
  BU_META.minYm = BU_PL.length ? minYm : "";
  BU_META.maxYm = maxYm;
}
