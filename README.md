# 集團管理 Dashboard

為廣告／PR agency 集團而建嘅 web-based management dashboard — 五大報表
（P&L / Balance Sheet / Budgeting / Cashflow / Cost Center）+ KPI modules +
例外警示。設計依 [`docs/blueprint.md`](docs/blueprint.md)（Build Blueprint v1.0）。

## 現況：Phase 1 UI 完成（DEMO 數據）

Dashboard 全部六頁已可運行，但目前行 **示範數據**（deterministic、虛構，
結構跟足真實集團：5 間公司 + Elimination、FY 4–3 月、report groups、15 個
departments、Untagged bucket）。每頁有 DEMO banner。

依 blueprint §10.5：**未過 §10.4 對數驗收，唔會開放真數俾管理層。**
真實 NetSuite sync 屬下一步（見下面 roadmap）。

## BU 還原模組（Blueprint v0.1 · 2026-09-16）

`/bu` 六頁：BU Cockpit、BU P&L（管理帳 per BU / 法定 per company、Layer 1 純業務 / Layer 2 分攤後、
drill-down）、Bridge（法定 → 剔 IC → BU → 分攤）、Shared cost 分攤（人頭 / GP / 收入 / 固定比例對比）、
BU Cashflow（payment link 按 department 分攤 + inter-co 結欠）、Data quality（未標 department、
IC 配對、mgmt fee 對稱、對照表）。

- 數據：`fact_bu_pl`（2021-04 起，按月 × 公司 × department × account × 交易類型 × IC entity）、
  `fact_bu_cash`（2025-04 起）；規則表 `bu_mapping` / `ic_entity_map` / `ic_account_map` /
  `allocation_rules` / `headcount_monthly` / `account_group_map`（`supabase/migrations/0002_bu_restoration.sql`）。
- 引擎：`apps/web/lib/bu.ts`（ic_flag、BU 歸集、Layer 1/2、Bridge、cash、data quality）；
  數據層 `apps/web/lib/bu-store.ts`。
- ETL / 增量：`packages/sync/bu-restoration.md`；blueprint 全文 `docs/bu-restoration-blueprint.md`。
- 704 成立前嘅 Production 業務坐喺 PBHK `Production` dept（bu_mapping 已映射 → Production BU），
  所以 FY2021/22 起可以連續睇；FY22/23 前 PBHK 未標 department 比例高，Data quality 頁有標示。

## Repo 結構（§10.1）

```
/apps/web          Next.js (App Router) dashboard — 六頁 + demo 數據層
/packages/sync     SuiteQL sync specs（§4）— production 接線用
/supabase          migrations（schema §3 + RLS §2.3）
/docs              blueprint.md（v1.0）
```

## 本地開發

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

## 數據層設計

- `apps/web/lib/dims.ts` — subsidiaries（NetSuite internal ids）、departments、
  report groups（P&L/BS 行項）
- `apps/web/lib/demo.ts` — deterministic demo facts（seeded PRNG，每次 build 數字一致）
- `apps/web/lib/queries.ts` — selector 層：P&L / BS / aging / cashflow /
  13-week forecast / cost center / 分攤 engine / KPI / 警示。
  Production 接 Supabase 時只需重寫呢層，頁面唔使郁。

## 接真數 roadmap（Phase 1 完成項）

1. NetSuite Integration Record + OAuth 2.0 M2M（唔好用 chat MCP connector）
2. Supabase project：跑 `supabase/migrations/0001_init.sql`，設定 Auth + RLS
3. Sync worker：依 `packages/sync/suiteql.ts` 接 Vercel Cron
   （`apps/web/app/api/cron/sync` 已留 stub），寫 `sync_log`
4. Env vars（Vercel）：`NETSUITE_ACCOUNT_ID` / `NETSUITE_CLIENT_ID` /
   `NETSUITE_CLIENT_SECRET` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` / `ALERT_EMAIL_API_KEY`
5. §10.4 對數驗收（bank / P&L / 合併 / aging / TB 平衡）→ 先開放俾用戶

## Open items（§9 — 需會計/管理層拍板）

Account→report_group mapping、AGI 定義（旅遊收入計唔計）、budget ORIGINAL
數字來源、Journal 入帳方式覆核、tagging 必填政策、警戒線數值、聯營公司呈現方式。
