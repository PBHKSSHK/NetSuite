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

/** §4.2 A/R open → fact_ar_open. Aging buckets computed app-side from duedate. */
export const AR_OPEN = `
SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity AS customer_id,
       tl.subsidiary AS subsidiary_id,
       t.foreignamountunpaid AS amount_open, t.currency
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
WHERE t.type = 'CustInvc' AND NVL(t.foreignamountunpaid, 0) <> 0
`;

/** §4.3 A/P open → fact_ap_open. */
export const AP_OPEN = `
SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity AS vendor_id,
       tl.subsidiary AS subsidiary_id,
       t.foreignamountunpaid AS amount_open, t.currency
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
WHERE t.type = 'VendBill' AND NVL(t.foreignamountunpaid, 0) <> 0
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

/** §4.5 payroll: derive from the existing saved searches
 *  (customsearch_iv_monthly_payroll & friends) — fetch their structure once via
 *  ns_runSavedSearch, then rewrite against the underlying customrecord_* here.
 *  Fallback: GL staff-cost accounts (report_group = OPEX_STAFF) + employee
 *  table for headcount. */
export const PAYROLL_TODO = null;
