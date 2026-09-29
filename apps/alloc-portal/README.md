# PBHK 分攤 Portal(會計專用)

單一靜態 app,部署為獨立 Vercel project `pbhk-alloc-portal`(rootDirectory = apps/alloc-portal)。
與老闆嘅集團管理 Dashboard(apps/web)分開:會計喺呢度做每月 allocation,老闆 dashboard 只讀 NetSuite→Supabase 還原數。

- 數據:FY2025/26 已上 NetSuite 之分攤(2025-26 PB cost allocation breakdown.xlsx),引擎逐科目重算並核對(±HK$2)
- 登入:Supabase(同 dashboard 一套賬號 @pbhk.info);注意登入檢查係 client-side,數據 inline 喺 HTML — 第二期應改 Supabase table + RLS
- 方法:關聯公司(JS/Go Asia)按當月人頭承擔科目「參與額」,餘額按年度 GP% 分五間 core
