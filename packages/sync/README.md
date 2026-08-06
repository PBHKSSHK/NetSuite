# Sync worker（Phase 1 — 未接線）

依 blueprint §2/§4：NetSuite SuiteQL（REST）→ idempotent upsert 入 Supabase，
每次寫 `sync_log`。呢個 package 而家收錄 **production SuiteQL specs**（見
`suiteql.ts`）；正式接線需要：

1. NetSuite Integration Record + **OAuth 2.0 client credentials (M2M)**，
   scope = REST Web Services（唔好用 chat 用嘅 MCP connector 做 production sync）。
2. Endpoint：`POST https://5247980.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`
   — 每頁上限 1,000 行，必須分頁；指數退避 retry。
3. Secrets 放 Vercel env vars（`NETSUITE_CLIENT_ID` / `NETSUITE_CLIENT_SECRET`），唔入 repo。
4. Cron：Vercel Cron routes（`apps/web/app/api/cron/*`，已留 stub）或 GitHub Actions。

## Sync 頻率（§2.2）

| 數據 | 頻率 | 方式 |
|------|------|------|
| Bank balance | 每小時 | 全量重算 |
| A/R・A/P open | 每小時 | 全量重算 |
| GL（fact_gl） | 每晚 full + 日間每小時 incremental | key = `transaction.lastmodifieddate` |
| Dimensions | 每晚 | 全量 upsert |
| Payroll | 每月（出糧後）或每晚 | 全量 |

## Build 時必須覆核（§9.3）

Audit 發現 `type='Journal'` 2025-04 起查無 lines — 接線時要查實 payroll／調整
分錄實際 transaction type，並以 **TB 對總數**（§10.4 驗收項 5：全年 debit 總和
= credit 總和）確保 GL extract 冇漏。
