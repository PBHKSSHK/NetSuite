# Photoblog 集團成本分攤 Rules（實際操作版）

**來源：** 會計提供 `2025.03_pb_admin_cost_allocation.xlsx`（FY2024/25 年結月）+
NetSuite 實帳驗證（2026-08-06）。呢份係 blueprint「Photoblog dept 分攤」嘅權威定義，
dashboard「分攤後 pro-forma」必須跟呢套邏輯。

## 1. 成本池（cost pools）

每月由 NetSuite 出 Photoblog **Income Statement by department**（workbook `master` sheet），
三個 PB 部門各成一個 pool：

| Pool | PB Department | Mar 2025 金額（overheads） |
|------|--------------|--------------------------|
| Admin | Admin, Finance, HR | 317,934.52（扣 venue income 等後淨額 183,523.27） |
| IT | IT Department | 47,745.53 |
| Mgt | Management | 231,583.15（連 other inc/exp 後 238,233.40） |

## 2. 分攤方法（Mar25 現行版）

**兩層：**

1. **Associates 先拎走份**——Go Asia Travel 同 JS（Jervois Solution）按 **headcount**
   分 Admin + IT pool（唔分 Mgt pool）：`B = pool × 該公司人數 ÷ 全體人數`。
   Mar 2025 headcount：704=5、SSHK=15、CLS=2、JM=6、Go Asia=1、JS=4（Σ=33）。
   **headcount 每月可以唔同**——係 input variable，唔係常數。
2. **剩餘按 GP% 分俾 4 間 NetSuite 子公司**——`C = A − B`，C 按 gross profit 比例分：
   704=**10.95%**、SSHK=**58.52%**、CLS Garage=**9.22%**、JM=**21.31%**（Σ=100）。
   Mgt pool 100% 行 GP%（associates 唔孭 Mgt）。
   ❓ 待會計確認：GP% 用邊段期間嘅 gross profit 計、幾耐 refresh 一次。

每條 account line 有 `A − B = C`、`B + C = D`、`A = D` 對數欄——sync 實施時照抄呢套 sanity check。

## 3. 每條數分兩類 → 兩種入帳方式（NetSuite 已驗證）

| 類別 | Workbook 標記 | NetSuite 入帳 | Mar 2025 實數 |
|------|-------------|--------------|--------------|
| **Reimbursement**（實報實銷類開支） | `reimbursement fee` | 每月 journal，memo *"Share of PBHK Admin, Finance, HR / IT / MGT Expenses for M/YYYY"*：PB **credit 返原本 81xxx expense account**（Admin/IT/Mgt dept），子公司 **debit 同一個 81xxx account**（落收方 department：Production／ePR／Sales／JM Team） | SSHK 67,684.23 ✓ 對上 worksheet |
| **Management fee**（Directors Remun、折舊、利息等） | `management fee` | 子公司 debit **81000059 Management Fee**；PB credit **60000022 Management Fee Income** | 704=36,836.61、SSHK=196,865.73、CLS=31,016.79、JM=71,688.46 —— **同 worksheet 一仙不差** ✓ |

PB 收嘅 Management Fee Income（Mar25 = 385,288.25）大過 4 間子公司總和（336,407.59），
差額應係向 associates／related companies（Go Asia、JS、J1 等）收嘅費用——❓ 請會計確認組成。

## 4. Provision flow（時間差——dashboard 最關鍵嘅位）

1. 每月會計喺 worksheet 計 provision（**唔入 NetSuite**）
2. Provision 以一粒大數放入 *PL by team*，行項叫 **"Share of Admin & Mgt Expenses"**（每間公司一行）
3. 數據 confirm 後（實務上係年度性）先經 CSV upload 入 NetSuite journals

**NetSuite 實查結果：** 分攤 journals 每月一條，由 2023 年起一直入到 **2025-03-31 為止**；
FY2025/26（2025-04 起）至今**未有** allocation journals —— 即係而家 GL 入面 PB 嘅
Admin/IT/Mgt 成本仲原封坐喺 PB 度，分攤只存在於會計 worksheet。

## 5. Dashboard 實施規則

1. **防雙重計數（最重要）**：以「該月有冇 allocation journals」判斷狀態——
   偵測條件：period 內有 memo `Share of %Expenses%` journals 或 81000059 有 activity。
   - 已上帳月份（≤2025-03）：GL 已含分攤，**唔可以**再 overlay
   - 未上帳月份（2025-04 起）：GL 係未分攤狀態，「分攤後 pro-forma」toggle 先按本 rules 計 overlay
2. **Pro-forma overlay 計法**＝第 2 節方法，inputs：三個 pool 當月金額（NetSuite 有）＋
   當月 headcount（要人手入／HR 數據）＋現行 GP%。Overlay 喺每間公司 P&L 顯示為一行
   "Share of Admin & Mgt Expenses"（同 PL by team 一致），分攤明細 modal 顯示 pool、keys、
   reimbursement vs management fee 拆分
3. **Associates**：Go Asia／JS 嘅 share 唔落任何 subsidiary P&L；集團層面體現為
   PB 嘅 Management Fee Income（應收 associates）
4. **Cost Center 頁**：PB Admin/IT/Mgt 三個 dept 喺未分攤月份會顯示大額成本——
   UI 應標明「未分攤（provision 於 pro-forma 檢視）」

## 6. 待會計拍板（加入 mapping draft ❓ 清單）

- GP%（10.95/58.52/9.22/21.31）嘅計算基準同 refresh 頻率
- Management Fee Income 385,288 與 4 子公司 336,408 差額嘅組成
- Provision 上帳頻率會唔會由年度改月度（如果改咗，第 5.1 條偵測邏輯自動適應）
