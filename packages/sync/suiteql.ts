// Production SuiteQL specs (blueprint §4). These strings are the single source
// of truth for the sync worker; each must be reconciled against the matching
// NetSuite native report before the job is considered done (§10.4).
// All queries are paged (pageSize = 1000).

/** §4.1 GL extract → fact_gl. Incremental: append
 *  `AND t.lastmodifieddate >= TO_DATE(:last_sync, 'YYYY-MM-DD')` then re-sum
 *  affected periods by transaction id. entity_id mapping to project happens in
 *  the worker (join against dim_project). */
export const GL_EXTRACT = `
SELECT
  t.postingperiod        AS period_id,
  tl.subsidiary          AS subsidiary_id,
  tal.account            AS account_id,
  tl.department          AS department_id,
  tl.entity              AS entity_id,
  SUM(NVL(tal.debit, 0)) AS debit,
  SUM(NVL(tal.credit, 0)) AS credit
FROM transactionaccountingline tal
JOIN transaction t  ON t.id = tal.transaction
JOIN transactionline tl
  ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
WHERE tal.posting = 'T'
GROUP BY t.postingperiod, tl.subsidiary, tal.account, tl.department, tl.entity
`;

/** §4.2 A/R open → fact_ar_open. Aging buckets computed app-side from duedate.
 *  Verified 2026-08-06 (docs/netsuite-verification-2026-08-06.md):
 *  - foreignamountunpaid is TRANSACTION currency → multiply by exchange rate
 *    into HKD base before storing (FX invoices exist).
 *  - Include CustCred; native A/R aging still differed by 0.08% on sub 2
 *    (suspect journals posted straight to AR) — resolve during §10.4 sign-off.
 *  - Flag intercompany customers (group companies appear inside trade A/R,
 *    e.g. SSHK holds HK$2.58M receivable from Photoblog). */
export const AR_OPEN = `
SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity AS customer_id,
       tl.subsidiary AS subsidiary_id, t.type,
       t.foreignamountunpaid AS amount_open_txn_ccy,
       t.exchangerate, t.currency
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
WHERE t.type IN ('CustInvc', 'CustCred') AND NVL(t.foreignamountunpaid, 0) <> 0
`;

/** §4.3 A/P open → fact_ap_open. Same base-currency + VendCred handling as A/R. */
export const AP_OPEN = `
SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity AS vendor_id,
       tl.subsidiary AS subsidiary_id, t.type,
       t.foreignamountunpaid AS amount_open_txn_ccy,
       t.exchangerate, t.currency
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
WHERE t.type IN ('VendBill', 'VendCred') AND NVL(t.foreignamountunpaid, 0) <> 0
`;

/** §4.4 bank balance → fact_bank_balance_daily (hourly snapshot). This query
 *  already reconciled to the balance sheet cash rows in the data audit. */
export const BANK_BALANCE = `
SELECT tl.subsidiary AS subsidiary_id, tal.account AS account_id,
       SUM(NVL(tal.debit,0) - NVL(tal.credit,0)) AS balance
FROM transactionaccountingline tal
JOIN transaction t ON t.id = tal.transaction
JOIN transactionline tl
  ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
JOIN account a ON a.id = tal.account
WHERE tal.posting = 'T' AND a.accttype = 'Bank'
GROUP BY tl.subsidiary, tal.account
`;

/** §4.5 payroll. Verified 2026-08-06: custom records exist
 *  (customrecord_iv_employeesalary / customrecord_iv_employee_leave) but the
 *  integration role has NO read permission (saved search and SuiteQL both
 *  denied). Either (a) admin grants the role access to both custom record
 *  types, or (b) fallback: payroll posts as Journals into accounts 592
 *  (Staffs Salaries) / 585 (MPF) / 577 (Directors Remunerations) — confirmed
 *  Apr–Jul 2026 = 59 lines, HK$2,540,113 — so GL staff-cost extraction works
 *  today; headcount then comes from the employee table. */
export const PAYROLL_TODO = null;

/** GL extract notes (verified): journals ARE covered by the 3-table join
 *  (8,225/8,225 lines since 2025-04); journals carry FUTURE trandates
 *  (accrual amortisation booked out to 2027-03) — always slice reports by
 *  postingperiod, never assume trandate <= today. FY2025/26 TB balances:
 *  debit = credit = 231,593,495.36 (§10.4 item 5 ✓). P&L spot check SSHK
 *  2026-06 matched the native Income Statement to the cent (§10.4 item 2 ✓). */
export const VERIFICATION_NOTES = "docs/netsuite-verification-2026-08-06.md";
