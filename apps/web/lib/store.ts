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

/** 收款明細（fact_collections — NetSuite 收款紀錄，payment_date 升序） */
export const COLLECTIONS: {
  paymentDate: string;
  subsidiaryId: number;
  customerName: string | null;
  invoiceTranid: string;
  invoiceMemo: string | null;
  amount: number;
}[] = [];

/** 最新 snapshot 逐個銀行戶口結餘（fact_bank_balance_daily × dim_account） */
export const BANK_ACCOUNTS: {
  subsidiaryId: number;
  accountId: number;
  name: string;
  balance: number;
}[] = [];

/** 客戶主檔（dim_client_info — 系統估算 seed；confirmed=false 即未經人手確認） */
export const CLIENT_INFO: {
  customerId: number;
  name: string;
  isRelated: boolean;
  isRetainer: boolean;
  retainerMonthly: number | null;
  sector: string | null;
  creditLimit: number | null;
  /** 首次開票月份 YYYY-MM（null = 未知） */
  firstYm: string | null;
  confirmed: boolean;
}[] = [];

/** 客戶逐月收入（fact_client_revenue — invoice − credit memo 淨額，HKD） */
export const CLIENT_REVENUE: {
  customerId: number;
  subsidiaryId: number;
  /** YYYY-MM */
  ym: string;
  amount: number;
}[] = [];

/** 未收 A/R 按客戶合計（由 fact_ar_open 嘅 customer_id 砌，唔使多一次 fetch） */
export const AR_BY_CUSTOMER = new Map<number, number>();

/** 供應商付款（出數）明細（fact_disbursements，payment_date 升序） */
export const DISBURSEMENTS: {
  paymentDate: string;
  subsidiaryId: number;
  vendorName: string | null;
  amount: number;
}[] = [];

/** AI CFO 週評（cfo_notes — 每週五 pg_cron 生成，week_of 升序；
 *  RLS 限 owner/accountant，其他 role 讀到空array係正常） */
export const CFO_NOTES: {
  weekOf: string;
  generatedAt: string;
  model: string;
  content: string;
}[] = [];

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
  fullname: string | null;
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

interface CollectionRow {
  payment_id: number;
  payment_date: string;
  subsidiary_id: number;
  customer_name: string | null;
  invoice_tranid: string | null;
  invoice_memo: string | null;
  amount_applied: number | string;
}

interface NamedDimRow {
  id: number;
  name: string;
}

interface ClientInfoRow {
  customer_id: number;
  name: string;
  is_related: boolean;
  is_retainer: boolean;
  retainer_monthly: number | string | null;
  sector: string | null;
  credit_limit: number | string | null;
  first_ym: string | null;
  confirmed: boolean;
}

interface ClientRevenueRow {
  customer_id: number;
  subsidiary_id: number;
  ym: string;
  amount: number | string;
}

interface CfoNoteRow {
  week_of: string;
  generated_at: string;
  model: string;
  content: string;
}

// ── fetch helpers ────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

/** 讀晒成張表——supabase-js 預設每次最多 1000 行（fact_gl 有 8,792 行），
 *  所以要用 .range() loop 分頁攞晒。orderCols 保證分頁順序穩定。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAll<T>(
  table: string,
  columns: string,
  orderCols: string[]
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let rows: T[] = [];
    // retry：新 project cold start 曾出現服務間時鐘漂移（"JWT issued at future"）；
    // JWT 類錯誤先 refresh session 攞新 token 再試，最多 3 次。
    for (let attempt = 1; ; attempt++) {
      let q = supabase.from(table).select(columns);
      for (const col of orderCols) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (!error) {
        rows = (data ?? []) as unknown as T[];
        break;
      }
      if (attempt >= 3) {
        throw new Error(`讀取 ${table} 失敗：${error.message}`);
      }
      await sleep(1500 * attempt);
      if (/jwt|token|issued|expired/i.test(error.message)) {
        await supabase.auth.refreshSession().catch(() => {});
      }
    }
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

/** 戶口顯示名：去掉層級（"Bank : "）同「Bank - 」prefix，
 *  例如 "Bank : Bank - Fubon - Current Accounts - M7325110 (PB)"
 *  → "Fubon - Current Accounts - M7325110 (PB)"。 */
function cleanAccountName(fullname: string): string {
  const idx = fullname.lastIndexOf(" : ");
  const leaf = idx >= 0 ? fullname.slice(idx + 3) : fullname;
  return leaf.startsWith("Bank - ") ? leaf.slice("Bank - ".length) : leaf;
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
    collectionRows,
    clientInfoRows,
    clientRevenueRows,
    disbursementRows,
    cfoNoteRows,
  ] = await Promise.all([
    fetchAll<PeriodRow>("dim_period", "id, fy_label, fy_month_no, start_date", ["id"]),
    fetchAll<ReportGroupRow>("report_group", "id, code, label, statement", ["id"]),
    fetchAll<AccountRow>("dim_account", "id, report_group_id, accttype, fullname", ["id"]),
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
    fetchAll<CollectionRow>(
      "fact_collections",
      "payment_id, payment_date, subsidiary_id, customer_name, invoice_tranid, invoice_memo, amount_applied",
      ["payment_date", "payment_id"]
    ),
    fetchAll<ClientInfoRow>(
      "dim_client_info",
      "customer_id, name, is_related, is_retainer, retainer_monthly, sector, credit_limit, first_ym, confirmed",
      ["customer_id"]
    ),
    fetchAll<ClientRevenueRow>(
      "fact_client_revenue",
      "customer_id, subsidiary_id, ym, amount",
      ["customer_id", "subsidiary_id", "ym"]
    ),
    fetchAll<{ payment_id: number; payment_date: string; subsidiary_id: number; vendor_name: string | null; amount: number | string }>(
      "fact_disbursements",
      "payment_id, payment_date, subsidiary_id, vendor_name, amount",
      ["payment_date", "payment_id"]
    ),
    fetchAll<CfoNoteRow>("cfo_notes", "week_of, generated_at, model, content", ["week_of"]),
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
  const relatedIds = new Set(clientInfoRows.filter((c) => c.is_related).map((c) => c.customer_id));
  const arItems: OpenItem[] = arRows.map((r) => ({
    txnId: r.tranid ?? String(r.txn_id),
    subsidiaryId: r.subsidiary_id,
    entityName:
      (r.customer_id != null ? customerName.get(r.customer_id) : undefined) ??
      `客戶 #${r.customer_id ?? "?"}`,
    tranDate: r.trandate,
    dueDate: r.duedate ?? r.trandate,
    amountOpen: num(r.amount_open),
    isRelated: r.customer_id != null && relatedIds.has(r.customer_id),
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

  // ── 逐個戶口結餘（最新 snapshot，收數週報「Bank balance」段用）
  const bankAccounts = bankRows
    .filter((r) => r.as_of_date === latestAsOf)
    .map((r) => ({
      subsidiaryId: r.subsidiary_id,
      accountId: r.account_id,
      name: cleanAccountName(accountById.get(r.account_id)?.fullname ?? `戶口 #${r.account_id}`),
      balance: num(r.balance),
    }));

  // ── 收款明細（fact_collections 已按 payment_date 排序）
  const collections = collectionRows.map((r) => ({
    paymentDate: r.payment_date,
    subsidiaryId: r.subsidiary_id,
    customerName: r.customer_name,
    invoiceTranid: r.invoice_tranid ?? "",
    invoiceMemo: r.invoice_memo,
    amount: num(r.amount_applied),
  }));

  // ── 客戶主檔 + 客戶逐月收入 + 按客戶 AR 合計（clients 頁真數層）
  const clientInfo = clientInfoRows.map((r) => ({
    customerId: r.customer_id,
    name: r.name,
    isRelated: r.is_related,
    isRetainer: r.is_retainer,
    retainerMonthly: r.retainer_monthly == null ? null : num(r.retainer_monthly),
    sector: r.sector,
    creditLimit: r.credit_limit == null ? null : num(r.credit_limit),
    firstYm: r.first_ym,
    confirmed: r.confirmed,
  }));
  const clientRevenue = clientRevenueRows.map((r) => ({
    customerId: r.customer_id,
    subsidiaryId: r.subsidiary_id,
    ym: r.ym,
    amount: num(r.amount),
  }));
  const arByCustomer = new Map<number, number>();
  for (const r of arRows) {
    if (r.customer_id == null) continue;
    arByCustomer.set(r.customer_id, (arByCustomer.get(r.customer_id) ?? 0) + num(r.amount_open));
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

  BANK_ACCOUNTS.length = 0;
  for (const a of bankAccounts) BANK_ACCOUNTS.push(a);

  COLLECTIONS.length = 0;
  for (const c of collections) COLLECTIONS.push(c);

  CLIENT_INFO.length = 0;
  for (const c of clientInfo) CLIENT_INFO.push(c);

  CLIENT_REVENUE.length = 0;
  for (const r of clientRevenue) CLIENT_REVENUE.push(r);

  AR_BY_CUSTOMER.clear();
  for (const [k, v] of arByCustomer) AR_BY_CUSTOMER.set(k, v);

  DISBURSEMENTS.length = 0;
  for (const d of disbursementRows) {
    DISBURSEMENTS.push({
      paymentDate: d.payment_date,
      subsidiaryId: d.subsidiary_id,
      vendorName: d.vendor_name,
      amount: num(d.amount),
    });
  }

  CFO_NOTES.length = 0;
  for (const n of cfoNoteRows) {
    CFO_NOTES.push({ weekOf: n.week_of, generatedAt: n.generated_at, model: n.model, content: n.content });
  }

  DATA_AS_OF.value = latestAsOf ? `${latestAsOf} sync` : "未有 sync 紀錄";
}
