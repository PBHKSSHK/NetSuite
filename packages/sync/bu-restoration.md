# BU 還原 ETL（fact_bu_pl / fact_bu_cash）

依 `docs/bu-restoration-blueprint.md` §3–§4。兩張 fact 由 NetSuite SuiteQL 按月抽取，
以 Supabase `fact_bu_pl` / `fact_bu_cash` 為 dashboard 數據源；ic_flag / BU 歸集喺
app（`apps/web/lib/bu.ts`）按 reference tables 即時推算，所以改 `bu_mapping` /
`ic_entity_map` 唔使重跑 ETL。

## 首次全量（已完成 2026-09-16：2021-04 → 2026-09）

經 NetSuite MCP 逐月執行下列 query（每月 2 條，避免全表子查詢 timeout），
再 `INSERT … ON CONFLICT DO UPDATE` 入 Supabase。

**Query A** — 所有 P&L 行，剔除「同單有 Amount Due From/To 對手方」嘅 Journal：

```sql
SELECT TO_CHAR(t.trandate,'YYYY-MM') AS ym, tl.subsidiary AS sub, NVL(tl.department,0) AS dept,
       tal.account AS acct, t.type AS ttype,
       CASE WHEN t.entity IN (<IC customer + vendor ids>) THEN t.entity ELSE 0 END AS ic_entity,
       SUM(NVL(tal.debit,0)) AS d, SUM(NVL(tal.credit,0)) AS c, COUNT(*) AS n
FROM transactionaccountingline tal
JOIN transaction t ON t.id = tal.transaction
JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
JOIN account a ON a.id = tal.account
WHERE tal.posting = 'T' AND t.posting = 'T'
  AND a.accttype IN ('Income','COGS','Expense','OthIncome','OthExpense')
  AND t.trandate >= TO_DATE(:start,'YYYY-MM-DD') AND t.trandate < TO_DATE(:end,'YYYY-MM-DD')
  AND NOT (t.type = 'Journal' AND EXISTS (
        SELECT 1 FROM transactionaccountingline x JOIN account ax ON ax.id = x.account
        WHERE x.transaction = t.id AND (ax.acctnumber LIKE '250000%' OR ax.acctnumber LIKE '35002%')))
GROUP BY …   -- → ic_journal = false
```

**Query B** — 只抽 IC journal（同上 EXISTS 條件，`t.type = 'Journal'`）→ `ic_journal = true`，
`txn_type = 'Journal'`、`ic_entity_id = 0`。

**Cash（§2.3 A）** — `CustPymt` → `nexttransactionlinelink(linktype='Payment')` → invoice 行
（`mainline='F' AND taxline='F' AND iscogs='F'`），收款按 `ABS(line.foreignamount) / ABS(invoice.foreigntotal)`
比例分攤到行 department；`VendPymt` → bill 行同理。已對 control total（不分行）一仙不差。

IC entity 清單 = `ic_entity_map`（customer 1447,1488,1489,2674,2762,2763,2792,2907,3201,3207,3245,3584,3958,4468,4576,4113；
vendor 863,1027,2714,2873,3106,3328,2568）。新增集團 entity 時要同步更新 `apps/web/app/api/cron/sync/route.ts` 內嘅常數。

## 每日增量

`apps/web/app/api/cron/sync/route.ts` 每次重抽最近 4 個月（含本月）嘅 fact_bu_pl / fact_bu_cash，
經 Supabase `ingest` edge function upsert（ALLOWED 已加兩張表）。前提：Vercel env
`NS_ACCOUNT / NS_CLIENT_ID / NS_CERT_ID / NS_PRIVATE_KEY / INGEST_SECRET / CRON_SECRET` 已設定
（截至 2026-09-16 `sync_log` 顯示 daily-sync-edge 因 `NS_ACCOUNT` 未設而失敗——要先補 secrets）。

## 對數（Phase 1 驗證）

- 每月 `SUM(debit) - SUM(credit)` by subsidiary = NetSuite Income Statement net（trandate 口徑）。
- Bridge 頁：Σ 公司外部 NP − Σ BU Layer 1 NP 必須 = 0（app 內即時檢查）。
- IC 抵銷淨額（mgmt fee / invoice / bill / journal）全年應接近 0；差額喺 Data quality 頁逐對公司列出。
