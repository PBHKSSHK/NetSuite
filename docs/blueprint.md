# 集團管理 Dashboard — Build Blueprint v1.0

**日期：** 2026-08-06
**讀者：** Claude Code（builder）、會計及管理層（reviewer）
**目標：** 為廣告／PR agency 集團建立一個 web-based management dashboard，數據來自 NetSuite，包含五大報表（P&L / Balance Sheet / Budgeting / Cashflow / Cost Center）、KPI modules 及警示。

---

## 0. 背景

### 0.1 集團結構（NetSuite subsidiary internal IDs — 已核實）

| ID | 公司 | 角色 |
|----|------|------|
| 1 | Photoblog.hk Limited | 母公司 |
| 2 | Social Strategy Hong Kong Limited | 子公司 |
| 5 | CLS GARAGE | 子公司 |
| 7 | Jervois M Limited | 子公司 |
| 8 | 704 Production Limited | 子公司 |
| 4 | Elimination | 抵銷用 subsidiary |
| -1 | Photoblog.hk Limited (Consolidated) | NetSuite 合併 view（native report 用） |

另有 2 間聯營公司（associates），不在 NetSuite subsidiary 內，帳上以 investment / dividend / gain 科目反映（64000003、64000002、64000004）。

### 0.2 關鍵事實
- 財政年度：**4 月至 3 月**。所有報表 period 預設以財年計（FY2026/27 = 2026-04 至 2027-03）。
- 所有 subsidiary base currency 均為 **HKD**（已核實）→ 合併 = 各 subsidiary（含 Elimination）直接加總，v1 毋須做 currency translation。外幣交易（USD/CNY/GBP/JPY/NTD/MYR/EUR 均 active）已由 NetSuite 折算入 base currency GL。
- NetSuite modules：Financials Mid-Market + Project Management + OneWorld。**冇** Financial Management module；Class dimension **未啟用**（SuiteQL 查 `classification` 會 error）→ Cost Center 完全依賴 Department。
- 用戶角色：4 位老闆、1 位會計、每公司 1 位 manager。

### 0.3 政策
- Photoblog 嘅 Admin/Finance/HR（dept 6）、IT（dept 11）、Management（dept 9）成本，按其餘 4 間公司 gross profit 比例分攤。FY2025/26 帳上未做 → dashboard 提供 **pro-forma 分攤 view**（見 §5.5）。
- 公司推行 paperless，文件保留 7 年 → 所有 sync 及報表生成需有 audit log。

---

## 1. Data Audit 結果（2026-08-06 於 live account 查證）

呢啲發現直接影響設計，Claude Code 建 schema 前必讀：

| # | 發現 | 對設計嘅影響 |
|---|------|--------------|
| 1 | CoA 結構清晰：收入分三大 branch（60xx Service Fee Income 14 個細分、61xx Travel Service Income、62xx Sales of Goods），成本分 Cost of Goods Sold 同 Cost of Services（13 個細分，含 Cost - Advertisement 即媒體投放） | AGI（gross income）可直接由 account group 計算，毋須改帳 |
| 2 | Department 15 個 active（Management=9、Admin Finance HR=6、IT=11、Editorial、Production、Account Servicing、Monitoring and Seeding、Sales、ePR Team、Commercial Team、Creative Team、JM Team、JS Sales Team、Travel Agency、Pro Health） | Cost Center 報表 = Department P&L；分攤 rule 針對 dept 6/9/11 |
| 3 | Tagging 覆蓋率（2025-04-01 起）：Vendor bill lines 2,336 條 — 有 department 54%（1,258）、有 line-level entity 71%（1,660）、掛到 project 26%（611）；Invoice lines 6,074 條 — 掛到 project 19%（1,165）；invoice header 直接開俾 project：0 | Cost Center 必須有「Untagged」bucket + tagging 率指標；Project P&L 屬 Phase 3，且需配合入單紀律改善 |
| 4 | Project records 1,364 個，全部無 inactivate | dim_project 要 sync 全量；建議日後定期 inactivate 完結項目 |
| 5 | Opportunity records：**0** 個（LSA saved searches 係 bundle 預設，未用過） | Pipeline module 剔出 v1，列為 optional（§6.6） |
| 6 | NetSuite budget 數據不存在／SuiteQL 不可查（`budgetlegacy`、`budgets` 均 error） | Budget master 放 Supabase，做 import + 編輯 UI（§5.3） |
| 7 | Journal lines（type='Journal'、mainline='F'、2025-04-01 起）查詢回傳 0 行 | Build 時需覆核 payroll／調整分錄實際用咩 transaction type 入帳，確保 GL extract 冇漏（見 §9 Open Items） |
| 8 | 現成可重用 saved searches：`customsearch_iv_monthly_payroll`（每月薪金+MPF）、`customsearch_iv_plan_emp_basic` / `_mpf_company` / `_mpf_staff`、`customsearch_iv_leave_application` | 人力成本 module 以呢啲邏輯為準，production sync 時以 SuiteQL 重寫（§4.5） |
| 9 | SuiteQL 銀行結餘已與 balance sheet 對數一致（早前核實） | Bank balance widget 用同一條 query 做基準 |

---

## 2. 系統架構

```
NetSuite (SuiteQL via REST)
      │  scheduled pulls
      ▼
Sync Worker（Vercel Cron routes / GitHub Actions）
      │  idempotent upserts + sync_log
      ▼
Supabase (Postgres + Auth + RLS)
      │
      ▼
Next.js dashboard on Vercel（GitHub repo, CI/CD）
```

### 2.1 NetSuite 接入（production）
- **唔好**用 Claude 嘅 MCP connector 做 production sync——嗰個係 chat 用。喺 NetSuite 建 Integration Record，用 **OAuth 2.0 client credentials (M2M)**，scope = REST Web Services。
- SuiteQL endpoint：`POST https://5247980.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`，每頁上限 1,000 行，必須分頁。
- Secrets 放 Vercel environment variables，唔入 repo。

### 2.2 Sync 頻率
| 數據 | 頻率 | 方式 |
|------|------|------|
| Bank balance | 每小時 | 全量重算 |
| A/R open、A/P open | 每小時 | 全量重算（open items 數量細） |
| GL / TB（fact_gl） | 每晚 full + 日間每小時 incremental | incremental key = `transaction.lastmodifieddate` |
| Dimensions（account/customer/project/department/subsidiary） | 每晚 | 全量 upsert |
| Payroll | 每月（出糧後）或每晚 | 全量 |

- 每次 sync 寫 `sync_log`（開始/完成時間、行數、錯誤）；dashboard 顯示「數據截至 HH:MM」+ 手動 refresh 掣（觸發 on-demand sync，rate-limit 每 10 分鐘一次）。
- Sync 失敗 → 見 §7 警示。

### 2.3 認證與權限
- Supabase Auth（email magic link 或 password）。
- RLS：`user_profiles(user_id, role, subsidiary_ids[])`。
  - `owner`（4 位老闆）：所有 subsidiary、所有報表。
  - `accountant`：所有 subsidiary + admin 功能（mapping 維護、budget import、alloc rules、sync monitor）。
  - `manager`：只見自己 `subsidiary_id`；可用 P&L、Cost Center、A/R aging（自己公司）；**見唔到**合併數同其他公司。

---

## 3. Supabase Data Model

> Migration files 放 `/supabase/migrations`。所有 fact tables 用 NetSuite internal ID 做 FK，方便對數。

**Dimensions**
- `dim_subsidiary(id, name, is_elimination)` — seed §0.1 資料
- `dim_account(id, acctnumber, fullname, accttype, parent_id, report_group_id)`
- `report_group(id, code, label, statement, sort_order)` — P&L/BS 行項定義（例：REV_SERVICE、REV_TRAVEL、REV_GOODS、COS_SERVICES、COS_GOODS、OPEX_STAFF、OPEX_RENT…）。**account → report_group mapping 由會計喺 admin UI 維護**，唔好 hardcode。
- `dim_department(id, name, is_allocatable)` — dept 6/9/11 標 `is_allocatable = true`
- `dim_customer(id, name)`、`dim_project(id, name, customer_id)`
- `dim_period(id, fy_label, fy_month_no, start_date, end_date)` — 由 NetSuite `accountingperiod` sync，加 FY 欄（4 月 = FY month 1）

**Facts**
- `fact_gl(period_id, subsidiary_id, account_id, department_id NULL, entity_id NULL, project_id NULL, debit, credit)` — grain 見 §4.1
- `fact_ar_open(txn_id, subsidiary_id, customer_id, tranid, trandate, duedate, amount_open, currency)`
- `fact_ap_open(txn_id, subsidiary_id, vendor_id, tranid, trandate, duedate, amount_open, currency)`
- `fact_bank_balance_daily(as_of_date, subsidiary_id, account_id, balance)`
- `fact_payroll_monthly(period_id, subsidiary_id, department_id, employee_count, basic_salary, mpf_er, mpf_ee, total_cost)`

**App tables**
- `budget_lines(fy, version, subsidiary_id, report_group_id, month_no, amount)` — version ∈ {ORIGINAL, FORECAST}
- `alloc_rules(fy, source_subsidiary_id, source_department_id, method, target_subsidiary_ids[])` — v1 method 固定 `GP_RATIO`
- `recurring_cash_items(subsidiary_id, label, direction, amount, day_of_month, active)` — 13-week forecast 用（租金等）
- `sync_log(job, started_at, finished_at, rows, status, error)`
- `user_profiles(user_id, role, subsidiary_ids[])`

---

## 4. Sync Specs（SuiteQL drafts）

> 以下 query 係起點；build 時逐條同 NetSuite native report 對數後先算完成（驗收標準見 §10.4）。全部要分頁（pageSize=1000）。

### 4.1 GL extract（`fact_gl`）
```sql
SELECT
  t.postingperiod        AS period_id,
  tl.subsidiary          AS subsidiary_id,
  tal.account            AS account_id,
  tl.department          AS department_id,
  tl.entity              AS entity_id,      -- line-level customer/project（可為 NULL）
  SUM(NVL(tal.debit, 0)) AS debit,
  SUM(NVL(tal.credit, 0)) AS credit
FROM transactionaccountingline tal
JOIN transaction t  ON t.id = tal.transaction
JOIN transactionline tl
  ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
WHERE tal.posting = 'T'
GROUP BY t.postingperiod, tl.subsidiary, tal.account, tl.department, tl.entity
```
- Incremental：加 `AND t.lastmodifieddate >= TO_DATE(:last_sync, 'YYYY-MM-DD')`，再以 transaction id 重算受影響 period。
- `entity_id` 若對應 `job.id` → 寫入 `project_id`（sync worker 內 join dim 判斷）。

### 4.2 A/R open（`fact_ar_open`）
```sql
SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity AS customer_id,
       tl.subsidiary AS subsidiary_id,
       t.foreignamountunpaid AS amount_open, t.currency
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
WHERE t.type = 'CustInvc' AND NVL(t.foreignamountunpaid, 0) <> 0
```
Aging buckets（current / 1–30 / 31–60 / 61–90 / 90+）喺 app 層以 `duedate` 計。

### 4.3 A/P open（`fact_ap_open`）
同 4.2，`t.type = 'VendBill'`，entity = vendor。

### 4.4 Bank balance（`fact_bank_balance_daily`）
```sql
SELECT tl.subsidiary AS subsidiary_id, tal.account AS account_id,
       SUM(NVL(tal.debit,0) - NVL(tal.credit,0)) AS balance
FROM transactionaccountingline tal
JOIN transaction t ON t.id = tal.transaction
JOIN transactionline tl
  ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
JOIN account a ON a.id = tal.account
WHERE tal.posting = 'T' AND a.accttype = 'Bank'
GROUP BY tl.subsidiary, tal.account
```
以早前已對數一致嘅版本為準；每小時 snapshot 落 `fact_bank_balance_daily`。

### 4.5 Payroll（`fact_payroll_monthly`）
- 邏輯依據現有 saved searches：`customsearch_iv_monthly_payroll`（Employee Salary custom record）、`customsearch_iv_plan_emp_basic`、`_mpf_company`、`_mpf_staff`。
- Build 時先用 `ns_runSavedSearch` 攞一次結構，再以 SuiteQL 對 custom record（`customrecord_*`——實際 script id 於 build 時查 `ns_getSuiteQLMetadata`）重寫成 production query。
- Fallback：若 custom record 唔可經 SuiteQL 查，改由 GL staff cost accounts（report_group = OPEX_STAFF）出數，headcount 由 `employee` table 計。

---

## 5. 五大報表 Specs

> 全部報表共通：期間切換（月／季／FY YTD，跟 4–3 月財年）、subsidiary 切換（單一公司 / 合併）、可 export xlsx、每格可 drill-down 到交易明細（讀 `fact_gl` 對應 transaction list）。合併 = 5 個 subsidiary + Elimination（ID 4）直接加總（全部 HKD base，已核實）。

### 5.1 P&L（損益表）
- **行項：** 由 `report_group`（statement='PL'）驅動，建議層次：
  - Revenue：REV_SERVICE（60xx）/ REV_TRAVEL（61xx）/ REV_GOODS（62xx）
  - Cost of sales：COS_SERVICES（Cost of Services branch，即 pass-through／外判）/ COS_GOODS
  - **Gross Profit** 及 **AGI**（= Service+Travel revenue − COS_SERVICES；精確定義由會計喺 mapping 確認）
  - Opex groups（OPEX_STAFF / RENT / DEPRECIATION / ADMIN / IT / MARKETING / OTHER）→ **EBITDA** → Net Profit
  - Other income（64xx，含聯營公司 dividend/gain 獨立一行）
- **欄：** Actual｜Budget｜Variance $｜Variance %｜Last Year，另有 12 個月 trend view。
- **Toggle：**「分攤前 / 分攤後」（分攤後 = 套用 §5.5 pro-forma allocation）。
- **來源：** `fact_gl` × `report_group`；Budget 欄來自 `budget_lines`。
- **權限：** owner/accountant 全部；manager 只見自己公司、冇合併。

### 5.2 Balance Sheet
- As-of date picker（預設今日）；行項由 `report_group`（statement='BS'）驅動：流動／非流動資產、負債、權益；Retained earnings = 歷年累計 + 本年 P&L（app 層計）。
- 銀行結餘一行必須同 bank balance widget（§6.1）完全一致——同一數據源。
- 合併版：直加含 Elimination；如與 NetSuite native consolidated report 有差異，列「對數差異」提示（見 §10.4）。
- 附 A/R、A/P 總額 drill-down 去 aging 報表。

### 5.3 Budgeting
- **Budget master 喺 Supabase**（NetSuite 冇 budget 數據，已核實）。
- Granularity：FY × version（ORIGINAL / FORECAST）× subsidiary × report_group × month（12 個月 phasing）。
- **Import UI：** 提供 xlsx template（行 = report_group，欄 = 12 個月，一 sheet 一公司）俾會計上載；亦可喺 web 直接編輯。改動寫 audit log。
- **Views：**
  - Budget vs Actual（月／YTD）：接入 P&L 每行
  - Full-year outlook = Actual YTD + Budget/Forecast 餘下月份
  - 各公司 budget 達成率 summary（老闆 view）
- 日後如想 budget 落到 department 層，schema 已預留（report_group × department optional 欄）。

### 5.4 Cashflow
三個 tab：
1. **實際現金流（月度）：** 由 bank accounts 嘅 GL 流水歸類——收客款（CustPymt）、付供應商（VendPym / BillPay）、糧金及 MPF、稅、intercompany、其他，得出每月淨現金流及期初期末結餘，按公司及合併。
2. **Weekly Customer Revenue & Cash Flow：** 取代現有人手報表——本週各客戶開票額、收款額、期末 A/R，及本週現金收支 summary，每週一自動生成並存檔（配合 7 年保留）。
3. **13-week rolling forecast：** 每週 bucket = A/R open 按 duedate（可調 collection lag 假設，預設 +14 日）+ A/P open 按 duedate + payroll（`fact_payroll_monthly` 出糧日）+ `recurring_cash_items`（租金等，會計維護）。輸出每週期末預計現金及最低現金警戒線對照。

### 5.5 Cost Center
- **本質：** Department P&L——`fact_gl` 以 department 維度切；行項同 P&L。
- **Views：** 單一公司 × 全部 department 矩陣；單一 department 跨公司；**「Untagged」bucket 必須顯示**（audit：vendor bill lines 只有 54% 有 department）。
- **Tagging hygiene 指標：** 每月 untagged 行數及金額 trend——俾會計追數，係 Cost Center 數據可信度嘅前提。
- **Photoblog 分攤 engine（pro-forma）：**
  1. 攞 Photoblog（sub 1）dept 6 / 9 / 11 嘅期內成本
  2. 計其餘 4 間公司（2、5、7、8）該期 Gross Profit 比例（由 `fact_gl` + report_group 計）
  3. 按比例分攤，輸出「分攤後」P&L overlay（唔郁 NetSuite 條數，純管理報表）
  4. 分攤明細表可 export，方便將來真正入帳時用
  - Rules 存 `alloc_rules`，會計可改 method／目標公司。

---

## 6. Dashboard KPI Modules

### 6.1 集團總覽（landing page，owner view）
- 每公司當日 bank balance + 集團合計 + 30 日走勢（已對數嘅 query）
- 每公司當月及 YTD：Revenue / GP / Net Profit，對 budget 及去年
- 合併 P&L snapshot、最低現金警戒指示燈

### 6.2 Agency 指標
- AGI 及 AGI margin（月／YTD）
- Staff cost ÷ AGI 比率（健康區間 50–60% 標示）
- Revenue per head（headcount 由 employee/payroll 數據）
- 客戶集中度：Top 5 / Top 10 客佔集團收入 %；retainer vs project 收入比（需 customer 或 income account 標記，Phase 2 定義）

### 6.3 現金流／營運資金
- A/R aging（bucket、by client、DSO）+ overdue 警示；A/P aging + DPO
- 墊資 exposure：已付供應商但未收客（Phase 3 精確到 project；Phase 1 先出公司層面 A/P paid vs A/R outstanding 對照）
- Unbilled/WIP（Phase 3，需 project 數據紀律）

### 6.4 人力成本
- 每月 payroll + MPF by 公司 by department、headcount 走勢
- Leave 統計（`customsearch_iv_leave_application` 邏輯；日後駁 Google Calendar）

### 6.5 例外警示中心
見 §7。

### 6.6 Pipeline（**optional，唔入 v1**）
- Audit 證實 opportunity records = 0。如管理層決定開始喺 NetSuite 入 opportunities，先啟動此 module（LSA saved searches 現成可用）。

---

## 7. 警示規則（Phase 2 起）

| 警示 | 條件（預設，admin 可調） | 通知對象 |
|------|--------------------------|----------|
| A/R 嚴重逾期 | 客戶 overdue > 60 日且金額 > HKD 50,000 | owner + accountant |
| 現金低於警戒線 | 任一公司 bank balance < 設定 floor | owner + accountant |
| Tagging 走樣 | 當月 untagged department 行數 > 上月 120% | accountant |
| Sync 失敗 | 任何 job 連續 2 次 fail | accountant |
| 項目超支 | 項目成本 > budget 80% 且未完結（Phase 3） | owner |

通知渠道 v1 = dashboard 內 alert center + email（Resend 或同類）。

---

## 8. Phasing

**Phase 1 — 基礎 + 核心報表**
架構搭建（repo / Supabase / sync worker / auth+RLS）→ dimensions + fact_gl + AR/AP + bank sync → P&L、Balance Sheet、bank balance widget、A/R & A/P aging → 對數驗收（§10.4）。

**Phase 2 — Budgeting + Cost Center + Cashflow**
Budget import UI + BvA → Cost Center（含 untagged bucket、hygiene 指標、分攤 pro-forma）→ Cashflow 三個 tab → 警示中心 → payroll module。

**Phase 3 — 項目盈利 + 深化**
Project P&L（前提：tagging 紀律改善，先出 coverage report）→ 墊資 exposure 落到 project → Unbilled/WIP → POS 對接（A/R settlement 自動化）→（可選）Pipeline。

---

## 9. Open Items（build 前需用戶／會計確認）

1. **Account → report_group mapping**：Claude Code 先 seed 全份 CoA（含 Expense accounts，audit 只拉咗 Income/COGS），再由會計喺 admin UI 確認分組；AGI 精確定義（Travel income 計唔計入 AGI）由會計拍板。
2. **Budget 數字來源**：會計以邊份 budget 做 ORIGINAL version？granularity 接唔接受 report_group × 月（定要落到 account）？
3. **Journal 入帳方式覆核**：audit 見 2025-04 起 type='Journal' 無 lines 回傳——build 時查實 payroll／調整分錄用咩 type（可能係 lastmodified 篩選或 type 差異），確保 GL extract 完整，以 TB 對總數為準。
4. **Tagging 政策**：建議喺 NetSuite form 將 department（及適用時 project）設為必填——決定咗，Cost Center 同 Project P&L 數據先會愈嚟愈準。
5. **警戒線數值**：每間公司最低現金 floor、A/R 警示金額門檻。
6. **聯營公司呈現**：P&L 只顯示 dividend/gain 一行係咪足夠，定需要獨立 associates summary page？

---

## 10. Claude Code 開發指引

### 10.1 Repo 結構（monorepo）
```
/apps/web          Next.js (App Router) dashboard
/packages/sync     sync jobs（Vercel Cron route handlers 或 GitHub Actions）
/packages/shared   types、report_group 常量、SuiteQL 字串
/supabase          migrations、RLS policies、seed
README.md          setup 步驟（NetSuite OAuth、env vars、首次 full sync）
```

### 10.2 Stack 建議
- Next.js App Router + TypeScript；UI 用 shadcn/ui；charts 用 Recharts；tables 用 TanStack Table；export 用 SheetJS。
- 起 UI 前先讀 `frontend-design` skill。
- Supabase JS client；所有讀取經 RLS；sync worker 用 service role key（只喺 server）。
- SuiteQL 呼叫：分頁 1,000 行、指數退避 retry、upsert idempotent（on conflict do update）。

### 10.3 Env vars
```
NETSUITE_ACCOUNT_ID=5247980
NETSUITE_CLIENT_ID / NETSUITE_CLIENT_SECRET   (OAuth2 M2M)
SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
ALERT_EMAIL_API_KEY
```

### 10.4 對數驗收標準（每項達成先可話完成）
1. Bank balance widget 每間公司 = NetSuite balance sheet 現金行（已有一次成功對數先例）。
2. 任一已關帳月份，P&L per subsidiary 總數 = NetSuite native Income Statement（可用 MCP `ns_runReport` spot check）。
3. 合併 P&L / BS = NetSuite consolidated report（subsidiary -1）；如有差異，列明原因。
4. A/R aging 總額 = balance sheet trade receivables；A/P 同理。
5. `fact_gl` 全年 debit 總和 = credit 總和（TB 平衡）。

### 10.5 唔好做
- 唔好 hardcode account/report mapping、分攤比例、警戒線——全部落 config tables。
- 唔好喺 client side 揸 NetSuite credentials。
- 唔好未過 §10.4 對數就開放俾管理層用。

---

*Blueprint v1.0 完。變更請以 PR 形式改此文件，保留版本歷史。*
