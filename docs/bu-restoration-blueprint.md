# BU P&L / Cashflow 還原 及 Management Dashboard Blueprint

版本：v0.1（2026-09-16）
用途：交予 Claude Code 建置。所有 NetSuite 事實均於 2026-09-16 經 NetSuite MCP（SuiteQL）核實。
技術棧（已定）：Claude Code + GitHub + Vercel（Next.js）+ Supabase（Postgres）；資料來源：NetSuite OneWorld（SuiteQL via MCP / REST）。

---

## 0. 一頁摘要

集團 5 間 NetSuite subsidiary 各自出法定報告，但實際業務係 4 個 BU（ePR、Production、JM、CLS）加 PBHK 的 admin/management 平台。BU 數據散落於 4 間公司，並被兩層 inter-co 扭曲：

1. **Admin & management fee**：PBHK 每月按人頭、年結按 BU GP% 向各公司收 management fee（PB 入 `60000022 Management Fee Income`，各公司入 `81000059 Department Cost : Management Fee`）。
2. **借公司名開單（pass-through）**：一間公司向客戶開單，再向實際做工的公司入 vendor bill，令開單公司出現 revenue ≈ COGS 的 pass-through 線。FY2025/26 集團內 customer invoice / vendor bill 總額約 HK$9.2M / HK$9.4M。

還原原則：**以 NetSuite line-level `department` 為 BU 主鍵，先剔除所有集團內交易（journal + invoice/bill），得出「BU 純業務 P&L」，再用統一、可調校的 allocation key 把 PBHK admin/mgt 成本分攤落 BU。** 法定帳（per subsidiary）與管理帳（per BU）並存，dashboard 可一鍵切換，並提供 bridge（法定 → 管理）解釋差異。

好消息：自 FY2023/24 起 P&L 交易 department 標記率 >97%（FY2025/26 >99%），還原 FY2023/24 至今三個年度可靠；FY2022/23 及之前 PBHK 有約 44% 交易冇 department，只能到公司層面。

---

## 1. NetSuite 現況（已核實）

### 1.1 Subsidiary
| id | 名稱 | 短碼 |
|---|---|---|
| 1 | Photoblog.hk Limited（母公司） | PBHK |
| 2 | Social Strategy Hong Kong Limited | SSHK |
| 5 | CLS GARAGE | CLS |
| 7 | Jervois M Limited | JM |
| 8 | 704 Production Limited | 704 |
| 4 | Elimination | — |

Class、Location 兩個 segment 未啟用（SuiteQL 查 `classification` / `location` 回 record not found）。`accountingperiod` table 對現有 role 不可見 → 期間以 `transaction.trandate` 推算（財年 4 月至 3 月）。

### 1.2 Department（活躍）
Account Servicing(3)、Admin, Finance, HR(6)、Commercial Team(13)、Creative Team(14)、Editorial(10)、IT Department(11)、JM Team(15)、JS Sales Team(17)、Management(9)、Monitoring and Seeding(7)、Pro Health(18, PBHK only)、Production(2)、Sales(8)、Travel Agency(16)、ePR Team(12)。
已停用：Analysis(4)、Business Development(5)、Creative(1)。

### 1.3 FY2025/26 各公司 × department 實際使用（Revenue / COGS / Opex，HK$）
| Sub | Department | Revenue | COGS | Opex |
|---|---|---|---|---|
| PBHK | Admin, Finance, HR | 2,455,073 | 0 | 2,738,961 |
| PBHK | Management | 1,449,178 | 0 | 1,334,022 |
| PBHK | Production | 5,802,092 | 3,489,106 | 2,632,465 |
| PBHK | ePR Team | 2,386,543 | 2,386,543 | 0 |
| PBHK | Pro Health | 370,600 | 195,014 | 0 |
| PBHK | (no dept) | 960,000 | 0 | 36,971 |
| SSHK | ePR Team | 14,501,361 | 6,122,051 | 7,536,764 |
| SSHK | JS Sales Team | 3,467,122 | 3,469,291 | 0 |
| SSHK | Monitoring and Seeding | 1,539,350 | 1,679,000 | 0 |
| SSHK | Production | 1,106,000 | 1,146,000 | 0 |
| CLS | Sales | 7,373,572 | 5,423,577 | 1,872,275 |
| JM | JM Team | 6,364,455 | 2,638,493 | 3,442,561 |
| 704 | Production | 2,568,950 | 1,666,160 | 815,210 |
| 704 | ePR Team | 64,000 | 0 | 0 |

觀察：
- PBHK ePR Team、SSHK JS Sales Team / Monitoring and Seeding / Production 四條線 revenue ≈ COGS，即係 pass-through（借名開單）。
- PBHK Admin, Finance, HR 及 Management 的 revenue 主要係 management fee income（FY25/26 共 2,759,552，其中 Admin 1,310,374、Management 1,449,178）。
- PBHK (no dept) revenue 960,000 = 每季 240,000 一筆（6 月、9 月、12 月、3 月），需確認性質及補 department。

### 1.4 Inter-co 機制（已核實）
**(a) Management fee 用 Journal**，冇 entity：
- PBHK：Dr `25000024-27 Amount Due From <sub> (To PB)` / Cr `60000022 Management Fee Income`
- 各 sub：Dr `81000059 Management Fee`（department = 該公司主 BU dept） / Cr `35002014/16/22/23 Amt Due To Photoblog.hk (from <sub>)`
- FY25/26 收費：SSHK 1,279,814 / CLS 365,895 / JM 584,796 / 704 199,463；PB 另收 Go Asia、JS（非 NetSuite subsidiary）。
- 另有 `81000068 Production Management Fee`（FY25/26 無交易）。

**(b) 借名開單 / 服務 recharge 用普通 Customer Invoice + Vendor Bill**，集團公司以普通 customer / vendor entity 出現（並無使用 NetSuite intercompany flag）。已識別 entity 見 §3.2 對照表。FY25/26 量：

| Sub | 對集團公司 CustInvc | 對集團公司 VendBill |
|---|---|---|
| PBHK | 1,294,934 (46) | 2,392,543 (23) |
| SSHK | 3,542,955 (50) | 4,576,129 (75) |
| CLS | — | 363,408 (15) |
| JM | 2,574,140 (38) | 1,362,599 (37) |
| 704 | 1,772,650 (29) | 686,909 (25) |

**(c) 結算**：透過 Amount Due From / To 帳戶（AcctRec / AcctPay 類型，`eliminate = F`），並有 FxReval 條目。

### 1.5 Department 標記覆蓋率（P&L 帳戶）
| 年度 | PBHK | SSHK | CLS | JM | 704 |
|---|---|---|---|---|---|
| FY22/23 及之前 | 59%（按金額） | 90% | ~100% | ~100% | 84% |
| FY23/24 | 94% | 98.5% | ~100% | ~100% | ~100% |
| FY24/25 | 97% | 100% | ~100% | 100% | 99.5% |
| FY25/26 | >99% | >99.9% | ~100% | 99.9% | 99.9% |

結論：**還原範圍建議 FY2023/24 → 現在**（3 個完整年度 + 本年度）。FY22/23 前只做公司層面 trend。

---

## 2. 還原方法論

### 2.1 BU 定義（口徑，2026-09-11 已定）
| BU | 組成 |
|---|---|
| **CLS** | CLS Garage 整間公司（所有 dept） |
| **Production** | 704 全部（扣 ePR Team）+ PBHK/SSHK/JM 內 `Production` dept |
| **ePR** | SSHK（扣 JS Sales Team、Monitoring and Seeding、Production）+ 704/PBHK/JM 內 `ePR Team` |
| **JM** | JM 全部（扣 ePR Team）+ 704/PBHK/SSHK 內 `Monitoring and Seeding` |
| **PB-Platform / Shared** | PBHK `Admin, Finance, HR`、`Management`、`IT Department`（待分攤） |
| **Other** | PBHK `Pro Health`、`JS Sales Team`（JS = Jervois Solution，非集團 BU）、`Travel Agency`、(no dept) |

實作上用一張 `bu_mapping (subsidiary_id, department_id, bu_code, effective_from, effective_to)` 表，而非 hard-code，方便日後改口徑並重跑歷史。

### 2.2 P&L 還原五步
1. **抽取**：所有 posting P&L 行（`transactionaccountingline` × `transactionline` × `account`），保留 subsidiary、department、account、entity、trandate、tranid、memo、type。
2. **標記 inter-co**（`ic_flag`）：
   - `IC_MGMT_FEE`：account ∈ {60000022, 81000059, 81000068}
   - `IC_INVOICE`：type ∈ {CustInvc, CustCred} 且 entity ∈ 集團 customer 對照表
   - `IC_BILL`：type ∈ {VendBill, VendCred} 且 entity ∈ 集團 vendor 對照表
   - `IC_JOURNAL_OTHER`：Journal 且同一 journal 有 Amount Due From/To 帳戶對手方（如租金、器材 recharge、extra mgt fee 等年結 tax planning 條目）
   - 其餘 = `EXTERNAL`
3. **BU 純業務 P&L（Layer 1）** = EXTERNAL 行按 `bu_mapping` 歸入 BU。Pass-through（借名開單）自動抵銷：開單公司的外部 revenue 歸入該 dept 所屬 BU；被 recharge 的 vendor bill 被剔除；做工公司向開單公司的 inter-co invoice 亦被剔除；做工公司的外部成本（人工、freelancer）留在其 BU。**結果：revenue 落在 department 所屬 BU，唔理由哪間公司開單**。
   - 注意：production team 人工由 PBHK 出、再 recharge 704 —— recharge 屬 IC，剔除；人工留 PBHK Production dept → 歸 Production BU，正確。
4. **Shared cost 分攤（Layer 2）**：PBHK `Admin, Finance, HR` + `Management` + `IT Department` 的外部 opex（扣除向 Go Asia / JS 的外部 admin fee income）按 `allocation_rules` 分攤落 4 個 BU + PBHK-Production 自留份。Key 可選：`headcount`（月結）、`gp_share`（年結）、`revenue_share`、`fixed_pct`；每月存一版 `allocation_run`，可對比「人頭法 vs GP 法」。
5. **Bridge（Layer 3）**：對每間公司每月出 reconciliation：法定 net profit → −IC mgmt fee → −IC invoice/bill → +/− 分攤 → BU 管理帳 net profit。總和必須 = 法定合計（elimination 後）。呢張 bridge 係老闆信任數字的關鍵。

### 2.3 BU Cashflow
銀行交易本身冇 department，而且大部分 shared cost（人工、租金）由 PBHK 一間出，所以「BU 真正銀行現金流」並不存在。建議兩層：

**A. BU Cash Contribution（可追溯部分）**
- 客戶收款：`previoustransactionlinelink (linktype='Payment')` 將 Customer Payment 連回 Invoice → 按 invoice line 的 department / 金額比例把收款分攤到 BU。FY25/26 起有 4,350 條 payment link，數據足夠。
- 供應商付款：Bill Payment → Vendor Bill 同樣連結 → 按 bill line department 分攤。
- 剔除集團內收付（entity 在對照表內）。
- Direct-method 輸出：BU 收客戶現金 − BU 付供應商現金 = **BU operating cash contribution**。

**B. BU Indirect Cashflow（推算）**
- BU EBITDA（Layer 2）− ΔBU A/R（按 invoice dept 開放金額）− ΔBU A/P + 分攤後 shared cost 現金化假設 = BU free cash proxy。
- 用 A 對 B 做 sanity check。

**C. 公司層面（法定）現金流** 照舊：bank balance（已核實 SuiteQL 可對數）、inter-co 應收應付淨額、A/R、A/P aging、還錢（director loan / Amount Due To Director）。集團合併 = 5 間 sum − inter-co。

老闆最想知的其實係：「每個 BU 每月帶入幾多現金、食咗幾多 shared cost、而集團邊間公司現金最緊」—— A + C 足以回答，B 作補充。

### 2.4 月結 Flash View
好多單月尾未入 → 兩層數：
- **Booked**：NetSuite 已 posting。
- **Flash**：Booked + 未開單 SO / 已開 quotation 應計收入（來自 Quotation→SO→Invoice control webapp，2025-03 起）+ 人工 accrual（AlphaHRMS 或上月數）+ 固定成本 accrual（租金、subscription 按上月）。
- Dashboard 顯示 Flash，並標示 Flash vs Booked 差異及「未入單清單」，過月後自動被 Booked 取代，並記錄 flash accuracy（估算誤差 trend）。

---

## 3. 資料模型（Supabase / Postgres）

### 3.1 Raw / staging（每日 sync）
```
ns_subsidiary, ns_department, ns_account, ns_entity
ns_transaction (id, type, tranid, trandate, postingperiod_derived, entity, memo, status, subsidiary)
ns_transaction_line (transaction, line_id, subsidiary, department, entity, memo, amount, quantity, item)
ns_accounting_line (transaction, line_id, account, amount, debit, credit, posting)
ns_txn_link (previousdoc, nextdoc, linktype, foreignamount)   -- payment/bill payment 應用
ns_bank_balance_daily (subsidiary, account, as_of, balance)
```
增量策略：以 `transaction.lastmodifieddate` 抽；每月 1 號全量重抽最近 3 個月（防 back-dated 入帳）。

### 3.2 Reference / rules（可在 admin UI 維護）
```
bu_mapping (subsidiary_id, department_id, bu_code, effective_from, effective_to)
ic_entity_map (entity_id, entity_type, counterparty_subsidiary_id, note)
   -- 初始值：customer 1447,1488,1489,2674,2762,2763,2792,2907,3201,3207,3245,3584,3958,4468,4576,4113
   --          vendor   863,1027,2714,2873,3106,3328,2568 ；Go Asia/JS/Jervois One 標為 related-party-external
ic_account_map (account_id, ic_type)   -- 60000022/81000059/81000068 = MGMT_FEE；250000xx/35002xxx = IC_BALANCE
allocation_rules (rule_id, cost_pool, key_type, effective_from, effective_to, params jsonb)
headcount_monthly (year_month, bu_code, headcount, source)   -- 手輸或 AlphaHRMS
account_group_map (account_id, mgmt_line)   -- 管理帳 P&L 行次：Revenue / Direct cost / Staff / Rent / Marketing / Admin / Depreciation / Finance / Tax
```

### 3.3 Derived（materialized views / nightly job）
```
fact_pl_line      -- 每條 P&L 行 + ic_flag + bu_code + mgmt_line + fy + fm
fact_bu_pl_month  -- Layer1 純業務 / Layer2 分攤後 / 法定，三個版本並列
fact_bridge_month -- 法定 → 管理帳 reconciliation
fact_bu_cash_month-- 客戶收款、供應商付款、IC 結算，按 BU
fact_ar_open / fact_ap_open -- 按 invoice、dept、customer、aging bucket
fact_ic_balance   -- 每對公司之間 Amount Due 淨額、月變動
flash_snapshot    -- 每月 flash 版本存檔
```

---

## 4. 關鍵 SuiteQL（供 Claude Code 起手）

**P&L 行（增量）**
```sql
SELECT t.id, t.type, t.tranid, t.trandate, t.entity, t.memo, t.lastmodifieddate,
       tl.id AS line_id, tl.subsidiary, tl.department, tl.entity AS line_entity, tl.memo AS line_memo,
       tal.account, tal.amount, tal.debit, tal.credit
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id
JOIN transactionaccountingline tal ON tal.transaction = t.id AND tal.transactionline = tl.id
JOIN account a ON a.id = tal.account
WHERE t.posting = 'T'
  AND a.accttype IN ('Income','COGS','Expense','OthIncome','OthExpense')
  AND t.lastmodifieddate >= TO_DATE(:since,'YYYY-MM-DD')
```
（必須分頁 pageSize 1000。）

**收款 → 發票連結**
```sql
SELECT ptl.previousdoc AS invoice_id, ptl.nextdoc AS payment_id, ptl.linktype, ptl.foreignamount,
       p.trandate AS pay_date, p.type AS pay_type
FROM previoustransactionlinelink ptl
JOIN transaction p ON p.id = ptl.nextdoc
WHERE ptl.linktype = 'Payment' AND p.trandate >= TO_DATE(:since,'YYYY-MM-DD')
```

**銀行結餘（已核實與 BS 一致）**
```sql
SELECT tl.subsidiary, tal.account, a.fullname, SUM(tal.amount) AS balance
FROM transactionaccountingline tal
JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
JOIN transaction t ON t.id = tal.transaction
JOIN account a ON a.id = tal.account
WHERE a.accttype = 'Bank' AND t.posting = 'T' AND t.trandate <= TO_DATE(:asof,'YYYY-MM-DD')
GROUP BY tl.subsidiary, tal.account, a.fullname
```

**Inter-co 淨額**
```sql
SELECT tl.subsidiary, a.acctnumber, a.fullname, SUM(tal.amount) AS balance
FROM transactionaccountingline tal
JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
JOIN transaction t ON t.id = tal.transaction
JOIN account a ON a.id = tal.account
WHERE t.posting = 'T' AND (a.acctnumber LIKE '250000%' OR a.acctnumber LIKE '35002%')
  AND t.trandate <= TO_DATE(:asof,'YYYY-MM-DD')
GROUP BY tl.subsidiary, a.acctnumber, a.fullname
```

---

## 5. Dashboard 內容（深化建議）

原定 5 頁：P&L、Balance Sheet、Budgeting、Cashflow、Cost Center。建議重組為以下 8 個模組，每頁頂部統一有 **View toggle：法定（per company）/ 管理（per BU）/ 集團合併**，及 **Booked / Flash** 切換。

### 5.1 Group Cockpit（老闆首頁，一屏睇完）
- 本月 / YTD 集團 revenue、GP、GP%、EBITDA、net profit（Flash），vs 上月、vs 去年同期、vs budget。
- 4 個 BU 卡片：revenue、GP%、分攤後 net、cash contribution，紅綠燈（vs budget ±10%）。
- 5 間公司今日 bank balance + 集團總現金 + 13 週現金 runway。
- 3 個警示：A/R >90 天 top 5、未開單 SO 總額、inter-co 淨額異常變動。

### 5.2 BU P&L
- 管理帳格式（Revenue → Direct cost → GP → Staff → Other opex → EBITDA → Depreciation/Finance → Net）。
- 三欄：純業務（Layer 1）/ 分攤後（Layer 2）/ 分攤方法切換（人頭 vs GP% vs 自訂）。
- 月度 trend 12–24 個月、YTD、同期比較。
- Drill-down：BU → department → account → transaction（連 NetSuite record link）。
- **Bridge 頁**：法定 5 間公司 net profit → BU 管理帳，逐項列 IC 剔除及分攤。

### 5.3 Legal Entity P&L / Balance Sheet
- 法定口徑，per subsidiary + consolidated（elimination）。
- Balance Sheet 重點：cash、A/R、A/P、inter-co due from/to、director loan、tax payable、equity。
- Tax planning view：每間公司 YTD 應課稅利潤估算、可用 tax loss b/f、建議 inter-co charge 空間（供年結 inter-co billing 決策）。

### 5.4 Cashflow
- 公司層面：期初現金 → 收客戶 → 付供應商 → 人工 → 租金/其他 → inter-co 結算 → 還錢/借款 → 稅 → 期末，按月，direct method（由 bank transaction 分類）。
- BU 層面：cash contribution（§2.3 A）及 indirect proxy（§2.3 B）。
- 13 週 rolling forecast：A/R 預計到期 + SO/retainer 排期 + 固定支出日曆（payroll、rent、MPF、稅）+ 已知一次性項目；情景（樂觀/基準/悲觀）。
- Inter-co 結算建議：哪間公司應該幾時 settle 畀邊間，令冇公司透支。

### 5.5 A/R、A/P 及 Billing Control
- A/R aging（按 BU、公司、customer、sales rep 姓名），DSO trend，逾期名單及催收狀態。
- A/P aging，DPO，即將到期付款。
- Quotation → SO → Invoice 漏斗（取代 Excel control）：未轉 SO 報價、未開單 SO、partial billing / retainer 進度、未收款 invoice、project code 對應。
- 借名開單追蹤：哪張外部 invoice 對應哪張 inter-co bill，配對狀態。

### 5.6 Cost Center / Shared Services
- PBHK admin / management / IT 成本池明細、月度 trend、per head 成本。
- 分攤結果對比：人頭法 vs GP% 法 vs 上年，每個 BU 差異。
- Go Asia / JS 外部 admin fee 收入對照分攤基礎。
- Recharge 合約狀態（704 40% production 人工、JS headcount 等）及其年度金額。

### 5.7 Budget vs Actual
- 按 BU 及公司輸入年度 budget（月度 phasing），Actual / Flash vs Budget，variance 分析（price/volume 簡化：revenue variance、GP% variance、opex variance）。
- 年度 forecast = YTD actual + 餘月 budget（可手動 override）。

### 5.8 Data Quality & Close Checklist
- 未標 department 的 P&L 行（目標 0）、集團 entity 未在對照表、IC invoice 無配對 bill、journal 一邊有一邊冇。
- 月結 checklist：bank rec 完成、mgmt fee journal 已入、accrual 已入、flash 已鎖定；每步狀態及負責人。
- Flash accuracy trend（flash vs 最終 booked）。

### 5.9 通用功能
- 每個數字可 drill 到 transaction list，並附 NetSuite URL。
- 匯出 Excel / PDF（老闆月會用）。
- 權限：老闆（全部）、會計（全部 + 規則維護）、各 BU manager（只見自己 BU）。
- 每月自動 snapshot，鎖定歷史數（restate 時保留舊版對照）。

---

## 6. 建置階段（交 Claude Code）

**Phase 0 – 基礎（1–2 週）**
Supabase schema（§3）、NetSuite sync job（SuiteQL 分頁、增量、重抽最近 3 個月）、Vercel cron、基礎 auth。

**Phase 1 – 還原引擎（2 週）**
`bu_mapping`、`ic_entity_map`、`ic_account_map` 初始化 → `fact_pl_line` → Layer 1 BU P&L → Bridge。以 FY2025/26 全年做驗證：Layer 1 各 BU 總和 + shared pool + other = 法定合計（IC 剔除後）。

**Phase 2 – 分攤 + Cashflow（2 週）**
`allocation_rules` + `headcount_monthly` → Layer 2；payment link → BU cash contribution；bank balance daily；inter-co balance。

**Phase 3 – Dashboard v1（2–3 週）**
Cockpit、BU P&L（含 Bridge）、Legal Entity、Cashflow、A/R & A/P。先出 FY2023/24–FY2025/26 歷史，再接每月。

**Phase 4 – Flash / Budget / Billing control（2–3 週）**
Quotation→SO→Invoice control、accrual 輸入、flash snapshot、budget 輸入、Data quality 頁。

每個 phase 都要有 reconciliation test：dashboard 合計 vs NetSuite 標準 P&L / BS report（`ns_runReport`）誤差 = 0。

---

## 7. 需要你確認 / 提供的事項

1. **PBHK (no dept) 每季 HK$240,000 收入**（6/9/12/3 月）係咩性質？應歸哪個 dept / BU？
2. **PBHK `Management` dept 有 1,449,178 revenue** —— 全部係 management fee income？定有其他？
3. **Pro Health、Travel Agency、JS Sales Team** 是否獨立作「Other」呈報，抑或併入某 BU？
4. **Go Asia / JS 收取的 admin fee** 是否用作抵減 shared cost pool 後再分攤（建議是）？
5. **Headcount 歷史**（FY23/24 起每月每 BU）有冇現成表？冇的話可先用 FY25/26 年結數倒推。
6. **年結 tax planning 的 inter-co journal**（租金、器材、extra mgt fee 等）：管理帳建議全部剔除，法定帳保留 —— 同意？
7. **借名開單**：對照表 (§3.2) 的 entity 清單是否齊全？特別係 Jervois One、Jervois Solutions、Go Asia 應視為集團內（剔除）定外部客戶？
8. Dashboard 語言：中文（老闆）/ 英文（會計）/ 雙語切換？
