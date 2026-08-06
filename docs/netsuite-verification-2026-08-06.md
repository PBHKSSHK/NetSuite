# NetSuite 接數前置驗證報告

**日期：** 2026-08-06 · **方式：** MCP 讀取（唔郁任何 NetSuite 數據）
**目的：** blueprint §4 SuiteQL specs 逐條喺 live account 驗證 + §9 open items 查證，為 production sync 掃清障礙。

## 結論一覽

| # | 項目 | 結果 |
|---|------|------|
| 1 | §4.4 Bank balance query | ✅ 跑通。5 subs 合計 HK$8.01M（sub1 2.16M / sub2 3.76M / sub5 731K / sub7 620K / sub8 748K） |
| 2 | §4.2/4.3 A/R・A/P open query | ✅ 跑通，**兩個要修正嘅位**（見下） |
| 3 | §4.1 GL extract 三表 join | ✅ 完整覆蓋 journal lines（8,225 條，borrow=credit 91,454,937.32） |
| 4 | §10.4-2 P&L 對數 spot check | ✅ **對到仙位**：SSHK 2026-06 native Income Statement vs SuiteQL — 收入 1,325,322 / COGS -1,049,385.42 / Overheads -344,336.20 / OthInc 2.83 / OthExp -12,211.02 / NP -80,607.81，全部一致 |
| 5 | §10.4-5 TB 平衡 | ✅ FY2025/26 全年 debit = credit = 231,593,495.36（20,119 lines） |
| 6 | §9.3 Journal 疑團 | ✅ **已解**。Journal 有 2,281 個（2025-04 起）；audit 當日 0 行係 query 寫法問題。**Payroll 以 Journal 入帳**（Apr–Jul 2026：59 lines、HK$2,540,113 入 Staffs Salaries/MPF/Directors Remunerations） |
| 7 | §4.5 Payroll custom record | ⚠️ Custom record 存在（`customrecord_iv_employeesalary`、`_iv_employee_leave`）但 **integration role 無讀取權**（saved search 同 SuiteQL 都拒絕）。二選一：(a) admin 俾權限，或 (b) 用 fallback：GL staff cost accounts 出數（已證可行） |
| 8 | §10.4-4 A/R aging 對數 | 🔶 SSHK：SuiteQL 6,084,097 vs native aging 6,079,227，差 **4,870（0.08%）**；唔係 open credit memo／未沖銷收款（已排除）。疑似直接過 AR account 嘅 journal — production build 時解決 |

## Production sync 要落實嘅修正

1. **AR/AP 要用 base currency**：open items 有外幣（AP 有 currency 2/5/7，例：sub1 一張 238,300 currency 7）。`foreignamountunpaid` 係交易貨幣——寫入 `fact_ar_open/fact_ap_open` 時要乘 exchange rate 折 HKD，或改用 base 欄位。
2. **AR/AP 種類要齊**：native aging 除 CustInvc/VendBill 外會計 open credit memos 同 journal 過 AR/AP 數——sync 要包 `CustCred`/`VendCred` 及覆核 AR/AP-account journals，先過到 §10.4-4。
3. **Journals 有未來日期**（預提/攤銷入到 2027-03，例：Google Workspace 月度攤銷）——報表一律以 **postingperiod** 切期，唔可以假設 trandate ≤ 今日。註：MCP 查唔到 `accountingperiod` record（tool 白名單），production OAuth 直查 REST 冇呢個限制。
4. **Interco 應收混喺 trade AR**：SSHK 6.08M AR 入面有 Photoblog 2.58M、Jervois M 1.03M、704 109K、Motoblog 44K——dashboard AR aging 必須分 **interco vs 外部客**（overview 嘅 DSO 亦應以外部客計）。
5. **Bank widget account 範圍要會計確認**：`accttype='Bank'` 會捉埋 Cash in Hand（27xx）同 **Control Account 37004010**（accttype 誤設為 Bank）——建議 bank widget 只計 26xx，其餘剔出。
6. **權限**：如要 payroll/leave module 用 custom record 明細，需 admin 將兩個 custom record types 加入 integration role 權限；否則行 GL fallback。

## 有用發現（順手記低）

- Native reports 有現成 **Custom Income Statement by department**（id 337）——Cost Center 對數用得着；**Intercompany Elimination / Reconciliation**（-231/-232）——interco 對數用。
- 聯營公司有 **3 間**入咗帳（Jervois T、Jervois Solution、Go Asia Plus Travel），blueprint §0.1 寫 2 間——請會計確認 associates 清單。
- CoA 詳細 mapping draft 見 `docs/account-mapping-draft.md`（306 個 active accounts 全數拉出）。
