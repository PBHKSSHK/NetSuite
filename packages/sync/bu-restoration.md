# BU 還原 ETL（fact_bu_pl / fact_bu_cash）

依 `docs/bu-restoration-blueprint.md` §3–§4。兩張 fact 由 NetSuite SuiteQL 按月抽取，
以 Supabase `fact_bu_pl` / `fact_bu_cash` 為 dashboard 數據源；ic_flag / BU 歸集喺
app（`apps/web/lib/bu.ts`）按 reference tables 即時推算，所以改 `bu_mapping` /
`ic_entity_map` 唔使重跑 ETL。

## 首次全量（2026-09-16 v1；2026-09-22 v2 IC journal 規則全量重載完成，fact_bu_pl_v1 保留備查）

載入狀態：2021-04 → 2023-04（2023-04 缺 Query B）、2024-01 → 2026-03（2026-03 缺 Query B）。
**待補**：2023-05 → 2023-12、2026-04 → 2026-09、2023-04 / 2026-03 嘅 Query B（NetSuite MCP 登入
過期中斷；重新授權後照下面 query 逐月補跑，upsert 冪等）。

經 NetSuite MCP 逐月執行下列 query（每月 2 條，避免全表子查詢 timeout），
再 `INSERT … ON CONFLICT DO UPDATE` 入 Supabase。

**Query A** — 所有 P&L 行，剔除 IC 分攤 / mgmt fee journal：

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
  AND t.id NOT IN (<該月 mgmt fee journal id 清單>)
GROUP BY …   -- → ic_journal = false
```

**Query B** — 只抽 IC 分攤 / mgmt fee journal（`t.id IN (<該月 journal id 清單>)`）→ `ic_journal = true`，
`txn_type = 'Journal'`、`ic_entity_id = 0`。

**Cash（§2.3 A）** — `CustPymt` → `nexttransactionlinelink(linktype='Payment')` → invoice 行
（`mainline='F' AND taxline='F' AND iscogs='F'`），收款按 `ABS(line.foreignamount) / ABS(invoice.foreigntotal)`
比例分攤到行 department；`VendPymt` → bill 行同理。已對 control total（不分行）一仙不差。

IC entity 清單 = `ic_entity_map` 全部 entity_id（2026-09-17：45 個）。新增集團 entity 時要同步更新
`apps/web/app/api/cron/sync/route.ts` 內嘅 `IC_ENT` 常數並補抽受影響月份。

## 每日增量

`apps/web/app/api/cron/sync/route.ts` 每次重抽最近 4 個月（含本月）嘅 fact_bu_pl / fact_bu_cash，
經 Supabase `ingest` edge function upsert（ALLOWED 已加兩張表）。前提：Vercel env
`NS_ACCOUNT / NS_CLIENT_ID / NS_CERT_ID / NS_PRIVATE_KEY / INGEST_SECRET / CRON_SECRET` 已設定
（截至 2026-09-16 `sync_log` 顯示 daily-sync-edge 因 `NS_ACCOUNT` 未設而失敗——要先補 secrets）。

## 對數（Phase 1 驗證）

- 每月 `SUM(debit) - SUM(credit)` by subsidiary = NetSuite Income Statement net（trandate 口徑）。
- Bridge 頁：Σ 公司外部 NP − Σ BU Layer 1 NP 必須 = 0（app 內即時檢查）。
- IC 抵銷淨額（mgmt fee / invoice / bill / journal）全年應接近 0；差額喺 Data quality 頁逐對公司列出。

## 已知範圍限制

- NetSuite MCP role 睇唔到 subsidiary 6（Go Asia Plus Travel）、3（CLS Production）、4（Elimination）
  嘅交易（SuiteQL 回 0 行），所以 `fact_bu_pl` 只含 5 間核心公司（1/2/5/7/8）——同 blueprint
  §1.1 口徑一致；Go Asia 以 associates 身份經 PB `60000022` 差額體現（Shared cost 頁）。
  每日 sync 用嘅 OAuth integration 有全 subsidiary 權限，日後 incremental 會補入 sub 6 行，
  `bu_mapping` 已將 sub 6 預設歸「其他」。
- FY2024/25 management fee 帳（60000022 / 81000059 / 81000068）按 trandate 口徑同 `fact_gl`
  （postingperiod 口徑）逐 department 一仙不差（2026-09-16 覆核）。

## 會計 worksheet 規則（2026-09-17，見 supabase/migrations/0003_allocation_reference.sql）

- `gp_share_monthly`：2 allocation.xlsx「GP%」— 每月各 worksheet 欄 GP%（PBHK Production / Youtube /
  704 Production / SSHK ePR / SSHK Comm / CLS / JM）。Youtube 同 PBHK Production 喺 NetSuite 同一 dept，
  app 併入 Production BU；SSHK Comm 併入 ePR。
- `headcount_monthly`：「headcount」sheet 逐月，含 JS / Go Asia（`ASSOC_JS` / `ASSOC_GOASIA`）。
- `director_alloc_monthly`：「director」sheet — 老闆人工 BU 報表口徑 + 帳面 ledger salary / MPF。
- `tax_saving_adjustments`：年結 tax planning 開單清單（正 = 開單方、負 = 被扣方）。
- `bu_reclass_rules`：2021-04 → 2021-09 PBHK Sales dept 81000084 / 81000063 → CLS（180,673.37 + 9,033.67，
  同 fact 逐月一仙不差）。
- 分攤引擎（`lib/bu.ts` `allocationFor(key='workbook')`）：Admin / IT pool 先扣 (JS + Go Asia) ÷ 全體
  headcount 份額，餘額按當月 GP% 分落 BU；Management pool 100% 按 GP%；老闆人工（81000039 + Mgt dept
  81000063）唔入 pool，按 director sheet 固定金額分落 BU，worksheet 與帳面差額留喺 PB 平台。
- Pool 組成（2026-09-22 對齊 cost allocation breakdown）：PB 平台 dept 6 / 11 / 9 外部行，但剔除
  (i) 老闆人工 81000039 + Mgt dept MPF 81000063（另按 director sheet），(ii) 收入 / 直接成本行
  （例：Mgt dept 掛嘅 Other Service Income + Cost of Advertisement pass-through），Venue Rental Income
  60000043 例外保留作 Admin pool 抵減，(iii) Audit Fee 81000015 同稅項 93xxxx。以 2025-03 對數：
  IT 47,745.53、Mgt 72,233.40（+ 老闆人工 166,000 = 238,233.40）同 breakdown 一仙不差；Admin 293,797.86
  vs breakdown 194,279.52，差額 = breakdown 將 DN 俾集團公司嘅 venue rental 收入（IC 90,274.60）淨入 pool
  + IC sundry credit 12,000 − 人工 2,756.26（breakdown 手工數）。本系統將 DN 兩邊剔除、全額租金按 GP% 分。
- 重載 seeds：`packages/sync/reference/0003_seed_allocation_reference.sql`（由 workbook 生成）。

## 會計 GP% 分攤交易清單（2026-09-22，見 supabase/migrations/0004_alloc_txn_ledger.sql）

- 來源：「BU gross profit share photoblog admin it mgt expenses adjustment 2020 - present.xlsx」。
  五個 GL 分頁（PB / SS / 704 / CLS / JM）= NetSuite 內按 BU gross profit 分攤去各公司嘅交易明細
  （2020-04 → 2026-03，10,741 行）：PB 側 credit 60000022 / 81xxx「Share of ... Expenses」/ DN 收入，
  子公司側 debit 81000059 / 81xxx「Share of PBHK ... Expenses」/ DN 費用，另有 tax planning invoice / bill。
  「headcount」「GP%」兩個分頁同 2 allocation.xlsx 一樣（已載入）。
- `alloc_txn_ledger`（原始行）+ `alloc_txn_summary` view（ym × 公司 × account × type × category）。
  category 由 account / description 推導：`MGMT_FEE`（60000022 / 81000059）、`SHARE_ADMIN` / `SHARE_IT` /
  `SHARE_MGT`（description「Share of ...」）、`DN_PROPERTY`（租金 / 大廈管理費）、`DN_ADVERTISING`、
  `IC_INVOICE_BILL`（invoice / bill）、`DN_OTHER`。
- 用途：
  1. Shared 頁「NetSuite 實際分攤 vs BU 還原」— GP% 機制（SHARE_* + MGMT_FEE）逐 BU 對比本系統
     Layer 2 還原（pool C + 老闆人工），差異 = 法定帳 / 管理帳口徑差。
  2. Quality 頁「會計 GP% 分攤清單覆蓋」— 每個（公司 × 月 × account）淨額 vs 本系統 IC 剔除行
     （ic_flag ≠ EXTERNAL），差額 ≠ 0 即有分攤交易未被識別為 IC。
- 重載 seed：`packages/sync/reference/0004_seed_alloc_txn_ledger.sql`（由 workbook 生成）。
