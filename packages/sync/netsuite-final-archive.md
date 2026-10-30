# NetSuite 最後全量導出（停用日 2026-10-30）

NetSuite 用到 2026-10-30，之後 5 間公司轉用 Xero（CLS Garage、SSHK 仲未搬晒數）。
停用前將 NetSuite 全部數據逐行抄入 Supabase schema `ns_archive`，作為：

- dashboard 歷史數（FY2025/26 及以前、FY2026/27 4–10 月）嘅永久來源；
- CLS / SSHK 搬數入 Xero 時對數用；
- 日後查單（drill-down）用——NetSuite 熄咗之後唯一副本。

## 內容

| 表 | 內容 |
|----|------|
| `ns_archive.gl_line` | 每條 posting accounting line（2011 → 2027），連 tranid、type、日期、period、subsidiary、account、department、class、entity、memo、借貸、外幣金額、匯率 |
| `ns_archive.record` | 原始 SuiteQL 行（jsonb）：`account` `accountingperiod` `subsidiary` `department` `classification` `location` `currency` `customer` `vendor` `employee` `transaction`（表頭）`ar_open` `ap_open` |
| `ns_archive.run_log` | 每次導出窗口：行數、借貸總數、同 NetSuite 對數結果（`ok` / `mismatch` / `error`） |

schema 只開畀 `service_role`（RLS on，anon / authenticated 讀唔到）。

## 點樣跑

Edge Function `archive-netsuite`（`supabase/functions/archive-netsuite/index.ts`），
header `x-archive-secret` = `public.app_secrets` 入面 `ARCHIVE_SECRET` 嘅值。

```bash
curl -X POST https://nlymvuwafgiudbqsyfem.supabase.co/functions/v1/archive-netsuite \
  -H "x-archive-secret: $ARCHIVE_SECRET" -H "Content-Type: application/json" \
  -d '{"part":"gl","from":"2026-07-01","to":"2027-01-01"}'
```

- `gl`：trandate ∈ [from, to)，先刪窗口再寫，可重跑；每次同 NetSuite 對行數 + 借貸。
- `txn`：同窗口交易表頭（upsert）。
- `master`：全部主檔（逐類型全量替換）；可傳 `"types": ["customer"]` 只跑部分。
- `open`：當刻 AR / AP 未清項目（全量替換）。

半年一個窗口，每次約 1 分鐘內完成。

## 停用前最後一次（2026-10-30 會計做完 10 月數之後）

重跑有改動嘅部分：

1. `gl` 2026-07-01 → 2027-01-01、2027-01-01 → 2028-01-01（10 月數 + 預提到 2027 嘅攤銷分錄）
2. `txn` 同上窗口
3. `master`、`open`
4. 查 `ns_archive.run_log` 全部 `ok`，再停 `daily-sync` / `daily-sync-edge`（pg_cron + Vercel Cron），
   否則 NetSuite 熄咗之後每日報錯。

## 對數

```sql
-- 每間公司每年借貸應該相等
select subsidiary_id, extract(year from trandate) yr, sum(debit) d, sum(credit) c
from ns_archive.gl_line group by 1, 2 order by 1, 2;
```

## 首次導出結果（2026-10-27）

- `gl_line` 176,043 行（2011-04-30 → 2027-03-31），33 個窗口全部同 NetSuite 對數一致（行數 + 借貸總數）。
- 交易表頭 52,229 張；主檔：科目 328、期間 315、公司 8、部門 18、class 13、客戶 665、供應商 1,072、員工 256。
- 未清：AR 331 張、AP 246 張（2026-10-27 snapshot，10-30 要重跑）。
- **NetSuite 本身有 18 張客戶發票借貸唔平衡**（2019-12 → 2022-09，主要 SSHK），合共貸方多 HK$1,033,773.70；
  導出同 NetSuite 一致，唔係導出問題。查法：

```sql
select txn_id, tranid, subsidiary_id, min(trandate) d, sum(coalesce(debit,0)) - sum(coalesce(credit,0)) diff
from ns_archive.gl_line group by 1, 2, 3
having abs(sum(coalesce(debit,0)) - sum(coalesce(credit,0))) > 0.005 order by d;
```

## 最後導出結果（2026-10-30 17:30 HKT）

- 重跑 `gl` 2025-01 → 2028-01（5 個窗口）全部同 NetSuite 對數一致；`txn` 2026–2027、`master`、`open`（AR 332、AP 246）完成。
- 合計：`gl_line` 176,049 行，交易表頭 52,230 張；33 個 GL 窗口全部 `ok`。
- 最後一次 Supabase 同步（`sync-netsuite`）2026-10-30 09:36 UTC 成功（GL 5,800 行）。
- 已停：pg_cron `daily-netsuite-sync`（保留 `weekly-cfo-memo`）。Vercel Cron 由 PR #6 刪除。
- **留意：NetSuite 入面 2026-09 / 10 數量好少**（每月 GL 行數：5 月 1,264、6 月 1,449、7 月 1,119、8 月 1,227、
  **9 月 369、10 月 103**），即係 9、10 月大部分交易冇喺 NetSuite 入帳，應該已經直接入咗 Xero 或者未入。
  呢兩個月嘅數要由 Xero 補，唔好當 NetSuite 數完整。
