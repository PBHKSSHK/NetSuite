# PBHK 分攤 Portal — Claude Code Build 指示

## 目標
將「分攤 Portal」(會計專用)部署做**獨立 Vercel project**,同老闆嘅集團管理 Dashboard(pbhk-group-dashboard,apps/web)完全分開。老闆 dashboard 一行代碼都唔使改。

## 檔案(本包內,已齊)
- `index.html` — 成個 portal(單一靜態頁):FY2025/26 全年 12 個月真數、兩層分攤引擎(關聯公司按當月人頭承擔科目「參與額」→ 餘額按年度 GP% 分五間 core)、Supabase 登入闸(同 dashboard 一套 @pbhk.info 賬號)、側欄有「↗ 集團管理 Dashboard」連結同登出掣。
- `alloc-data.js` — 12 個月已核對數據(引擎重算 vs Excel 已過賬 summary,全年最大差異 HK$0.04)。
- `README.md` — 背景說明。

## 步驟
1. 喺 repo `PBHKSSHK/NetSuite` 開 branch(例:`alloc-portal`),將三個檔案放入 `apps/alloc-portal/`。
   (參考:之前有個未 push 到嘅 commit 訊息 —「Add accounting allocation portal as standalone Vercel app」)
2. Vercel(team `pbhk`)開**新 project**:`pbhk-alloc-portal`
   - Framework preset: **Other**(純靜態,無 build command,無 output directory 設定)
   - Root Directory: `apps/alloc-portal`
   - 連 GitHub repo `PBHKSSHK/NetSuite`,production branch 設做 `alloc-portal`(或 merge 入 default branch 後用 default;注意 default branch 係 `claude/markdown-dashboard-vercel-xxzmt3`,係老闆 dashboard 嘅 production branch,merge 前確認唔會觸發 apps/web 改動)
3. Deploy 後驗證:
   - 開 https://pbhk-alloc-portal-pbhk.vercel.app (實際域名以 Vercel 分配為準)
   - 未登入:只見登入畫面,唔見數據 UI
   - 用 dashboard 賬號登入(username → username@pbhk.info)→ 見到 portal,預設 2026年3月
   - 每月計算頁每個 section 有「✓ 對上 Excel」;總覽 banner 顯示最大差異 HK$0.04
   - 側欄「↗ 集團管理 Dashboard」連到 https://pbhk-group-dashboard-pbhk.vercel.app/bu
4. (可選)老闆 dashboard 唔使加連結 — 按用戶要求兩個 app 分開:老闆睇 dashboard,會計用 portal。

## 重要注意
- **保安層級**:登入闸係 client-side(Supabase getSession/signIn),數據 inline 喺 HTML — 識途人直接 fetch HTML 可以繞過。URL 唔好公開派;第二期正路做法:分攤數入 Supabase table + RLS,portal 改做 authed 查詢。
- Supabase project:nlymvuwafgiudbqsyfem(anon key 已喺 index.html,屬公開 key,安全)。
- 唔好將呢啲檔案放入 apps/web 或改 components/shell.tsx — 用戶明確要求兩個 app 分開。
- FY2026/27 GP% 未定(portal 規則頁已有提示),4 月前要入新比例。
