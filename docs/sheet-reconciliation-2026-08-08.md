# 會計 Google Sheet 對數報告（2026-08-08）

**來源：** 會計每月手動上傳嘅 Google Sheet（PL by team 系列） vs live NetSuite
**方法：** 抽 18 個 check-figures 逐個經 SuiteQL / native report 對數

---

## 1. 呈現方式分析

**資料截點注意**：本 workbook 實數只去到 **Mar-2026**（FY25/26 完整年度）；Apr-26/May-26 標明 "Estimate"，Jun-26 之後全部係 0。Cashflow/AR 更只更新到 **11/12/2025**。所以 check-figures 揀咗 FY2025/26 月份，冇 2026 年 4–7 月實數可用。

### 核心呈現骨架：兩層 dimension 切換
成本 workbook 嘅設計哲學係「**時間永遠做橫軸，dimension 靠換 sheet / 換 row-block 切換**」：

- **P&L 類 sheets（Summary / 704 / CLS Garage / JM / epr / JS / group cost / Travel）**：全部同一格式 —— 行 = P&L line items，列 = 連續月度 Apr-2021 至今，**每 12 個月（財年 4 月–3 月）一個 block，block 尾插 "Total" 同 "Average" 欄**，年度 block 之間留一條空 column 做視覺分隔。未關帳月份喺 row 2/3 標 "Estimate"。呢個 rolling 月度＋財年小計並排係老闆睇趨勢嘅主要手法，dashboard 必須復刻。
- **Summary（集團 P&L）**：Top line 直接由 "Total Gross Profit" 開始（收入細節下放到單位 sheets），之後 overhead 逐項 → Total Overheads → Operating Profit → Other Income/Expenses → **Net Profit 有四層「漸進調整」**：Net Profit → After Purchase of equipment → +ESS/bonus 調整 → After 搬遷/還原費（一次性項目獨立列出先扣）。最底 rows 120–128 有 **"Breakdown of Net Profit by 業務單位"（youtube / 704 / CLS / JM / Comm / ePR）**——即係喺同一個時間軸下，由「科目 view」切去「單位 view」，係最值得復刻嘅 dimension 切換。
- **單位/公司 P&L sheets**：頂部係 **project-level 收入明細（project code + client + project name 三欄識別）**，落到 project total → Gross Profit → 之後同 Summary 一樣嘅 overhead/net profit 結構。ePR sheet 仲分 "SSHK - Retainer" vs "SSHK - Project" 兩個收入 block（retainer/project 分拆值得復刻）。CLS 有 GP% row。group cost sheet 底部列明 "share cost to the following team"（集團成本分攤俾 7 個 team）。
- **cf summary（現金流）**：唯一「**公司做列**」嘅 sheet —— 每個財年一個 block，block 內 columns = PBHK/SSHK/JM/704/CLS/Total 並排；rows = Sources of cash（收 AR、其他）→ Applications（糧、MPF、租、AP…）→ **Cash Surplus from Operation → Inter-Group Funds Transfer → 貸款動作 → Net Movement → 期初/期末結餘 → 對 bank statement reconciliation（逐個戶口 HSBC/恒生/OCBC）→ 銀行貸款餘額**。「五公司並排＋集團 total」呢個 layout 係老闆一眼睇晒邊間公司食錢/出錢嘅關鍵，加上 inter-group transfer 獨立一行（operation 現金流 vs 資金調撥分開睇），強烈建議復刻。
- **cf movement**：同一套 cashflow categories，但轉返「月度做列」嘅集團合併版——即係同一份數有「per 公司」同「per 月」兩個 view，兩 sheet 互補。
- **收數表（AR aging）**：NetSuite 匯出格式，rows = 逐張 invoice + customer sub-total，columns = aging buckets（Current/30/60/90/>90），A 欄標 BU（PBHK/SSHK/JM/704/CLS），row 153 grand total。
- **forecast cashflow**：Mar–Sep 2026 向前 7 個月，rows = client × project，係 forward-looking view。
- **YT time cost**：月度 timesheet，client × 同事 hours → 攤時間成本。

### Dashboard 復刻重點清單
1. 月度 columns 連續滾動 + 財年 Total/Average 小計欄 + Estimate 月份標記
2. Net Profit 多層 bridge（core → 減 equipment → 減一次性搬遷/還原費）
3. 同一時間軸下科目 view ⇄ 業務單位 breakdown view 切換
4. Cashflow 五公司並排 + inter-group transfer 獨立顯示 + 銀行戶口 reconciliation
5. 單位 P&L 由 project 明細 roll-up 到 GP，retainer vs project 收入分拆，CLS 的 GP%

## 2. Check-figures（18 個，已寫入 JSON 並逐格核對無誤）

File: `/tmp/claude-0/-home-user-NetSuite/48bc5680-9722-5a09-934f-d3a061f14140/scratchpad/sheet-figures.json`

| Sheet!Cell | 公司 | 期間 | 指標 | 數值 |
|---|---|---|---|---|
| Summary!BQ5 | Group | 2025-07 | Total Gross Profit | 1,707,637.91 |
| Summary!BZ5 | Group | FY25/26 | Total GP 全年 | 20,131,976.36 |
| Summary!BQ92 | Group | 2025-07 | Net Profit | 172,298.01 |
| Summary!BZ92 | Group | FY25/26 | Net Profit 全年 | 3,320,354.59 |
| epr!BQ71 | SSHK | 2025-07 | Retainer 收入 | 604,756.01 |
| epr!BZ268 | SSHK | FY25/26 | ePR Project GP 全年 | 7,956,115.32 |
| epr!BV350 | SSHK | 2025-12 | ePR Net Profit | 31,481.46 |
| JM!BQ73 | JM | 2025-07 | Project Income | 304,270.00 |
| JM!BZ73 | JM | FY25/26 | Project Income 全年 | 3,820,461.77 |
| JM!BV154 | JM | 2025-12 | Net Profit | 64,578.73 |
| CLS Garage!BR33 | CLS | 2025-07 | Gross Profit | 190,726.89 |
| CLS Garage!BV120 | CLS | 2025-11 | Net Profit | 160,357.31 |
| 704!BR178 | 704 | 2025-07 | Gross Profit | 379,847.48 |
| 704!BW265 | 704 | 2025-12 | Net Profit | -447,093.90 |
| cf summary!W48 | PBHK | 2025-12-11 | Ledger 現金結餘 | 772,741.08 |
| cf summary!X51 | SSHK | 2025-12-11 | Bank statement 結餘 | 1,989,048.22 |
| cf summary!AB51 | Group | 2025-12-11 | 五公司 bank 結餘合計 | 4,569,093.59 |
| 收數表!M153 | Group | 2025-12-10 | AR aging 總額 | 4,413,219.99 |

**對數 caveats**：(a) 704/ePR 嘅 Net Profit 係業務單位 view，已含 group cost 分攤（見 group cost sheet r132-140），未必等於 NetSuite subsidiary 法定 P&L，GP/收入類數字對數較穩陣；(b) Summary GP 係集團合計，ePR 收入掛 SSHK 名下；(c) Feb-2026 有異常大數（704 NP 2.98M），似年終調整，避開咗冇揀做 check figure；(d) 收數表係 NetSuite "Custom A/R Aging Summary by subsidiary" 匯出，snapshot 日期 10/12/2025。

---

# NetSuite 對數結果(18 個 check-figures)

**方法**:SuiteQL 直接砌 P&L/結餘(transactionaccountingline,posting='T'),銀行/AR 用累計 debit−credit,AR 另外跑咗 native「Custom A/R Aging Summary by subsidiary」(report id 330, as-of 2025-12-10, consolidated)。已確認 Elimination subsidiary (id 4) **零過帳**,即 NetSuite 五間公司相加係無 interco 對銷嘅 raw 數。

## 對數表

| # | Sheet/Cell | Metric (period) | Sheet 值 | NetSuite 值 | 差額 (Sheet−NS) | 差 % | 判斷 |
|---|---|---|---|---|---|---|---|
| 1 | Summary BQ5 | Group GP 2025-07 | 1,707,637.91 | 1,961,962.66 (raw);對銷 interco 後 1,747,095.13 | −254,324.75 (raw) / −39,457.22 (對銷後) | −13.0% / −2.3% | **EXPLAINABLE** — sheet 係 interco 對銷基準:July interco 收入 1,062,441.23,買方入 COGS 嘅鏡像只有 847,573.70(其餘入 opex),對銷後殘差得 −39,457(可能仲有 Jervois/Bonham/Go Asia 類關聯客戶被 sheet 剔除) |
| 2 | Summary BZ5 | Group GP FY25/26 | 20,131,976.36 | 19,434,352.39 (raw 全年 actual) | +697,623.97 | +3.6% | **MISMATCH(待解釋)** — sheet 反而高過 raw actual;若 FY 同月度一樣係對銷基準,like-for-like 差距更大(~+3M)。懷疑 FY 欄喺 12 月中 snapshot 時包含 Dec–Mar forecast 未 true-up(actual Dec–Mar GP 得 7.42M 且極波動) |
| 3 | Summary BQ92 | Group NP 2025-07 | 172,298.01 | 365,822.62 (raw);對銷後 275,167.62 | −193,524.61 / −102,869.61 | −52.9% / −37.4% | **EXPLAINABLE(部分)** — interco 對銷解釋 90,655(CLS↔Motoblog 對出組外);殘差 −102,870 符合 worksheet-only provisions/分攤 pattern,建議攞 provision 明細印證 |
| 4 | Summary BZ92 | Group NP FY25/26 | 3,320,354.59 | 1,450,737.42 | +1,869,617.17 | +128.9% | **MISMATCH(待解釋)** — actual 全年 NP 遠低過 sheet。actual Dec–Mar NP:Dec +113K / Jan −1,023K / Feb +4,055K / Mar −1,403K,極 lumpy;sheet 應係 snapshot 時 forecast。必須同會計 walkthrough |
| 5 | epr BQ71 | SSHK Retainer Total 2025-07 | 604,756.01 | 604,665.00(items: Retainer Service 501,190 + Community Mgmt 90,750 + Reporting 5,500 + Neutralization 7,225) | +91.01 | +0.015% | **MATCH** — retainer bucket = 一籃子 retainer 相關 service items,差 $91 |
| 6 | epr BZ268 | ePR GP FY | 7,956,115.32 | 8,076,539.65 (SSHK Income−COGS) | −120,424.33 | −1.5% | **EXPLAINABLE** — BU (ePR) 口徑 vs 成間 SSHK subsidiary;SSHK 收入含 interco 代收(704/JM 經 SSHK 開單);差 1.5% 好貼 |
| 7 | epr BV350 | ePR NP 2025-12 | 31,481.46 | 114,544.36 (SSHK Dec NP) | −83,062.90 | −72.5% | **EXPLAINABLE** — BU view + 2025-04 後 Share of Admin & Mgt 分攤只喺 worksheet;Dec 喺 12-11 snapshot 時未埋數/半 forecast |
| 8 | JM BQ73 | Project Income 2025-07 | 304,270.00 | 246,670.00 (Income 492,045 − COGS 245,375) | +57,600 | +23.4% | **EXPLAINABLE(部分)** — sheet 定義係扣直接成本後淨額(FY 幾乎 tie 得住,見 #9),月度 project-對-月 mapping 唔同;殘差 57,600 未逐項 tie |
| 9 | JM BZ73 | Project Income FY | 3,820,461.77 | 3,773,961.77 (FY Income−COGS) | +46,500.00 | +1.2% | **EXPLAINABLE** — 差啱啱好 46,500 整數(cents .77 完全吻合),應係一單 project/provision 或 Jan–Mar forecast 高過 actual;僅僅超出 1% match 線 |
| 10 | JM BV154 | NP 2025-12 | 64,578.73 | 49,421.81 | +15,156.92 | +30.7% | **EXPLAINABLE** — Dec 喺 snapshot 時未埋數(JM Dec 有 437,800 COGS,唔少係之後先入);金額細 |
| 11 | CLS BR33 | GP 2025-07 | 190,726.89 | 78,786.04(Income 335,194 − COGS 256,407.96;連 OthInc 79,052.57) | +111,940.85 | +142% | **MISMATCH** — NetSuite 成個 COA **無** sponsorship income account;CLS 七月收入只有 Motorbike Accessories;試勻 Apr–Dec 每個月都冇一個月 GP = 190,726.89。Sheet 嘅「sponsorship」部分喺 NetSuite 搵唔到對應,要問會計來源 |
| 12 | CLS BV120 | NP 2025-11 | 160,357.31 | 189,593.19 | −29,235.88 | −15.4% | **EXPLAINABLE** — 差額 ≈ 每月 Share of Admin & Mgt 分攤(worksheet-only),方向同數量級完全符合 |
| 13 | 704 BR178 | GP 2025-07 | 379,847.48 | −150,307.39 | +530,154.87 | n/m | **EXPLAINABLE(部分)** — 704 七月 NetSuite 收入 100% 係開俾 SSHK 嘅 interco(170,500),真項目收入後期先開單(9 月有 1,193,000 大單);worksheet 用 project 完成月做 revenue/cost matching,NetSuite 用 invoice 日。個別月無法 tie,建議攞 project list 核對 |
| 14 | 704 BW265 | NP 2025-12 | −447,093.90 | −118,723.02 | −328,370.88 | n/m | **EXPLAINABLE(部分)** — BU view + group cost allocation(worksheet-only)+ project matching;殘差大,要分攤表印證 |
| 15 | cf W48 | PBHK cash per ledger @2025-12-11 | 772,741.08 | 769,535.99 (26xx) | +3,205.09 | +0.41% | **MATCH**(<1%;連 27xx cash-in-hand 就係 777,566.46,差 −0.62%,一樣 <1%) |
| 16 | cf X51 | SSHK bank per statement @2025-12-11 | 1,989,048.22 | 1,899,714.81 (26xx ledger);snapshot 時只入咗 1,670,072.41 | +89,333.41 | +4.7% | **EXPLAINABLE** — statement vs ledger 基準差(在途/未兌現項目),加上 snapshot 後有 backdated 入帳;屬正常 bank rec 項目,建議攞 SSHK bank rec 核對 89K 組成 |
| 17 | cf AB51 | Group bank per statement @2025-12-11 | 4,569,093.59 | 5,153,031.30 (26xx ledger);snapshot 時只入咗 4,002,686.99 | −583,937.71 | −11.3% | **EXPLAINABLE(部分)** — 兩個效應疊加:①statement vs ledger 基準;②snapshot 後 group 有 +1,150,344 bank 入帳係 backdate 返 12-11 前(單係 CLS 佔 +1,025,546——即 12-11 當日 CLS 條 ledger 落後成 1M)。要五間公司 bank rec 先 tie 得實 |
| 18 | 收數表 M153 | A/R aging total @2025-12-10 | 4,413,219.99 | 11,052,783.83(native report 330 as-of 12-10 = GL AcctRec 一樣) | −6,639,563.84 | −60.1% | **EXPLAINABLE(scope)+ 數據質素警示** — 收數表只計**外部** trade debtors;NetSuite AcctRec 包:25xxx interco「Amount Due From」戶口(淨 −1,733,878)+ 23001010 內嘅關聯公司客戶 gross 結餘(SSHK 13.36M、PB 11.31M、704 3.18M、Motoblog 2.51M…)再被 −27.8M **無 entity 嘅 journal** 抵銷。因為收款好多用無客戶 journal 入帳,NetSuite 客戶層面 aging 根本砌唔返 sheet 個 4.41M,exact tie-out 做唔到 |

## 總結

- **MATCH:2 個**(#5 SSHK Retainer 差 $91;#15 PBHK cash 差 0.41%)
- **EXPLAINABLE:13 個**,原因 pattern 好清晰:
  1. **Interco 對銷**:worksheet group P&L 有做 elimination,NetSuite 無(Elimination sub 零過帳)。July 量化到:interco 收入 1.06M、鏡像 COGS 0.85M,對銷後 group GP 殘差只剩 −39K。
  2. **Worksheet-only 分攤/provision**:Share of Admin & Mgt(2025-04 後只喺 worksheet)——CLS Nov 差 −29,236 同呢個 pattern 完全吻合;ePR/704 Dec「business-unit view」同理。
  3. **Project-basis vs invoice-basis**:704/JM 月度 GP 係 project 完成月口徑,NetSuite 係 invoice 日口徑,個別月差好遠但 FY 收窄(JM FY 差 1.2%)。
  4. **Snapshot/backdating**:cf 同 12 月數係 12 月中 snapshot;之後 NetSuite 有大量 backdated 入帳(bank group +1.15M,CLS 一家 +1.03M)。
  5. **AR scope**:收數表 = 外部 debtors only;NetSuite AcctRec 混咗 interco 結餘同無 entity 收款 journal。
- **MISMATCH(真對唔上,要 walkthrough):3 個**
  - **#11 CLS July GP +111,941**:sheet 嘅 sponsorship 成分喺 NetSuite 完全無對應 account,任何月份都 tie 唔到。
  - **#2 FY GP +698K / #4 FY NP +1.87M**:sheet FY 總數高過 NetSuite 全年 actual(NP 高 129%),同月度嘅對銷基準方向自相矛盾,最大可能係 12 月 snapshot 入面 Dec–Mar 係 forecast 未 true-up——但呢個要會計確認,唔可以就咁當解釋咗。
- **另外兩個審計觀察**(非 check-figure 本身):①收款用無 entity journal 過 AR,搞到 NetSuite 客戶 aging 唔可靠;②AR 內 interco gross 結餘極大(PB/SSHK 互相 >11M),清理前 consolidated AR 報表無意義。