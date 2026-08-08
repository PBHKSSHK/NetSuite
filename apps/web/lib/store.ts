// ─────────────────────────────────────────────────────────────────────────────
// LIVE DATA STORE (hydration layer).
// hydrate() 由 Supabase 讀齊所有 dim / fact 表落 memory，砌成同 demo.ts 一樣
// 嘅 shapes，再 in-place 填入下面嘅 mutable arrays——queries.ts 簽名零改動，
// 頁面照舊經 selector functions 讀數。
// RLS：所有表要登入（owner role）先讀到，所以 hydrate 只可以喺有 session 時行
// （DataBoot 負責把關）。
// ─────────────────────────────────────────────────────────────────────────────

import { PL_GROUPS } from "./dims";
import { supabase } from "./supabase";
import type { BankPoint, MonthlyFact, OpenItem } from "./types";

export const DATA_MODE = "live" as const;

// ── mutable module-level stores（初始為空，hydrate 完成後 in-place 填入，
//    確保其他 module import 咗嘅引用照樣生效）─────────────────────────────────

export const PL_FACTS: MonthlyFact[] = [];
export const AR_OPEN: OpenItem[] = [];
export const AP_OPEN: OpenItem[] = [];
export const BANK_TODAY: Record<number, number> = {};
export const BANK_POINTS: BankPoint[] = [];
export const DATA_AS_OF: { value: string } = { value: "" };

// ── Supabase row shapes ──────────────────────────────────────────────────────

interface PeriodRow {
  id: number;
  fy_label: string;
  fy_month_no: number;
  start_date: string;
}

interface ReportGroupRow {
  id: number;
  code: string;
  label: string;
  statement: string;
}

interface AccountRow {
  id: number;
  report_group_id: number | null;
  accttype: string | null;
}

interface GlRow {
  period_id: number;
  subsidiary_id: number;
  account_id: number;
  department_id: number | null;
  debit: number | string | null;
  credit: number | string | null;
}

interface ArOpenRow {
  txn_id: number;
  subsidiary_id: number;
  customer_id: number | null;
  tranid: string | null;
  trandate: string;
  duedate: string | null;
  amount_open: number | string;
  currency: string | null;
}

interface ApOpenRow {
  txn_id: number;
  subsidiary_id: number;
  vendor_id: number | null;
  tranid: string | null;
  trandate: string;
  duedate: string | null;
  amount_open: number | string;
  currency: string | null;
}

interface BankRow {
  as_of_date: string;
  subsidiary_id: number;
  account_id: number;
  balance: number | string;
}

interface NamedDimRow {
  id: number;
  name: string;
}

// ── fetch helpers ────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

/** 讀晒成張表——supabase-js 預設每次最多 1000 行（fact_gl 有 8,792 行），
 *  所以要用 .range() loop 分頁攞晒。orderCols 保證分頁順序穩定。 */
async function fetchAll<T>(
  table: string,
  columns: string,
  orderCols: string[]
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase.from(table).select(columns);
    for (const col of orderCols) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`讀取 ${table} 失敗：${error.message}`);
    }
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── hydrate ──────────────────────────────────────────────────────────────────

let hydratePromise: Promise<void> | null = null;

/** 一次過 fetch 全部所需表並砌好 in-memory stores。冪等：重複呼叫共用同一個
 *  promise；失敗會 reset，容許 retry。 */
export function hydrate(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = doHydrate().catch((e) => {
      hydratePromise = null;
      throw e;
    });
  }
  return hydratePromise;
}

async function doHydrate(): Promise<void> {
  const [
    periods,
    groups,
    accounts,
    glRows,
    arRows,
    apRows,
    bankRows,
    customers,
    subsidiaries,
  ] = await Promise.all([
    fetchAll<PeriodRow>("dim_period", "id, fy_label, fy_month_no, start_date", ["id"]),
    fetchAll<ReportGroupRow>("report_group", "id, code, label, statement", ["id"]),
    fetchAll<AccountRow>("dim_account", "id, report_group_id, accttype", ["id"]),
    fetchAll<GlRow>(
      "fact_gl",
      "period_id, subsidiary_id, account_id, department_id, debit, credit",
      ["period_id", "subsidiary_id", "account_id", "department_id"]
    ),
    fetchAll<ArOpenRow>(
      "fact_ar_open",
      "txn_id, subsidiary_id, customer_id, tranid, trandate, duedate, amount_open, currency",
      ["txn_id"]
    ),
    fetchAll<ApOpenRow>(
      "fact_ap_open",
      "txn_id, subsidiary_id, vendor_id, tranid, trandate, duedate, amount_open, currency",
      ["txn_id"]
    ),
    fetchAll<BankRow>(
      "fact_bank_balance_daily",
      "as_of_date, subsidiary_id, account_id, balance",
      ["as_of_date", "subsidiary_id", "account_id"]
    ),
    fetchAll<NamedDimRow>("dim_customer", "id, name", ["id"]),
    fetchAll<NamedDimRow>("dim_subsidiary", "id, name", ["id"]),
  ]);

  // lookup maps
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  void subsidiaries; // dims.ts 已 hardcode SUBSIDIARIES（ids 已核對）；讀返嚟留待 sanity check 用

  // sign 正規化規則來自 dims.ts ReportGroup.sign（+1 收入類 / -1 成本類）
  const plSign = new Map<string, 1 | -1>(PL_GROUPS.map((g) => [g.code, g.sign]));

  // ── MonthlyFact：每行 fact_gl → account → report_group code。
  //    冇 mapping 或 BS group 嘅行唔入 P&L facts。
  //    granularity 跟 demo：每個 (fy, sub, group, month) aggregate 做一行。
  //    budget kind 未有真數源——唔生成（sumFacts budget 自然係 0）。
  const factAgg = new Map<string, MonthlyFact>();
  for (const r of glRows) {
    const acct = accountById.get(r.account_id);
    if (!acct || acct.report_group_id == null) continue;
    const grp = groupById.get(acct.report_group_id);
    if (!grp || grp.statement !== "PL") continue;
    const sign = plSign.get(grp.code);
    if (sign === undefined) continue;
    const period = periodById.get(r.period_id);
    if (!period) continue;
    const debit = num(r.debit);
    const credit = num(r.credit);
    const amount = sign === 1 ? credit - debit : debit - credit;
    const key = `${period.fy_label}|${r.subsidiary_id}|${grp.code}|${period.fy_month_no}`;
    const cur = factAgg.get(key);
    if (cur) {
      cur.amount += amount;
    } else {
      factAgg.set(key, {
        fyLabel: period.fy_label,
        subsidiaryId: r.subsidiary_id,
        groupCode: grp.code,
        month: period.fy_month_no,
        kind: "actual",
        amount,
      });
    }
  }
  const facts: MonthlyFact[] = [];
  for (const f of factAgg.values()) {
    facts.push({ ...f, amount: Math.round(f.amount) });
  }

  // ── OpenItem（AR：entityName 用 dim_customer；AP 冇 vendor dim 表，
  //    直接用 "Vendor #" + vendor_id，簡單直接）
  const arItems: OpenItem[] = arRows.map((r) => ({
    txnId: r.tranid ?? String(r.txn_id),
    subsidiaryId: r.subsidiary_id,
    entityName:
      (r.customer_id != null ? customerName.get(r.customer_id) : undefined) ??
      `客戶 #${r.customer_id ?? "?"}`,
    tranDate: r.trandate,
    dueDate: r.duedate ?? r.trandate,
    amountOpen: num(r.amount_open),
  }));
  const apItems: OpenItem[] = apRows.map((r) => ({
    txnId: r.tranid ?? String(r.txn_id),
    subsidiaryId: r.subsidiary_id,
    entityName: r.vendor_id != null ? `Vendor #${r.vendor_id}` : r.tranid ?? String(r.txn_id),
    tranDate: r.trandate,
    dueDate: r.duedate ?? r.trandate,
    amountOpen: num(r.amount_open),
  }));

  // ── 銀行結餘：最新 as_of_date snapshot，per subsidiary sum
  let latestAsOf = "";
  for (const r of bankRows) {
    if (r.as_of_date > latestAsOf) latestAsOf = r.as_of_date;
  }
  const todayBySub: Record<number, number> = {};
  for (const r of bankRows) {
    if (r.as_of_date !== latestAsOf) continue;
    todayBySub[r.subsidiary_id] = (todayBySub[r.subsidiary_id] ?? 0) + num(r.balance);
  }
  for (const k of Object.keys(todayBySub)) {
    todayBySub[Number(k)] = Math.round(todayBySub[Number(k)]);
  }

  // ── 30 日 series：而家只有一個 snapshot，先生成一條平線（30 日全用今日值）。
  //    日後每日 sync 會累積真數，到時改為直接讀每日 rows 砌真曲線。
  const points: BankPoint[] = [];
  if (latestAsOf) {
    const latestMs = Date.parse(`${latestAsOf}T00:00:00Z`);
    for (let d = 29; d >= 0; d--) {
      const date = new Date(latestMs - d * 86_400_000).toISOString().slice(0, 10);
      for (const [subStr, bal] of Object.entries(todayBySub)) {
        points.push({ date, subsidiaryId: Number(subStr), balance: bal });
      }
    }
  }

  // ── commit：in-place 更新，令已 import 嘅引用即時見到新數據 ────────────────
  PL_FACTS.length = 0;
  for (const f of facts) PL_FACTS.push(f);

  AR_OPEN.length = 0;
  for (const i of arItems) AR_OPEN.push(i);

  AP_OPEN.length = 0;
  for (const i of apItems) AP_OPEN.push(i);

  for (const k of Object.keys(BANK_TODAY)) delete BANK_TODAY[Number(k)];
  Object.assign(BANK_TODAY, todayBySub);

  BANK_POINTS.length = 0;
  for (const p of points) BANK_POINTS.push(p);

  DATA_AS_OF.value = latestAsOf ? `${latestAsOf} sync` : "未有 sync 紀錄";
}
