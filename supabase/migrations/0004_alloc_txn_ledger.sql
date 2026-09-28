-- BU 還原 v0.3：NetSuite 內按 GP% 分攤去各公司嘅交易明細（2026-09-22）
--  來源：BU gross profit share photoblog admin it mgt expenses adjustment 2020 - present.xlsx
--  五個 GL 分頁（PB / SS / 704 / CLS / JM）= 會計年結按 BU gross profit 分攤
--  PBHK Admin / IT / Mgt 開支、mgmt fee、DN（租金 / 大廈管理費 / 廣告費）同 tax planning 開單嘅
--  NetSuite 交易。用途：
--   1. 對數：本系統 IC 剔除（ic_flag ≠ EXTERNAL）是否完整覆蓋會計清單
--   2. 展示：NetSuite 實際分攤（GP%）vs BU 還原分攤

create table if not exists alloc_txn_ledger (
  id serial primary key,
  company text not null,            -- worksheet 分頁：PB / SS / 704 / CLS / JM
  subsidiary_id int not null,       -- 1 / 2 / 8 / 5 / 7
  acct_number text not null,
  acct_name text,
  txn_type text not null,           -- Journal / Invoice / Bill
  trandate date not null,
  ym text not null,
  txn_number text,                  -- e.g. JOURNAL20077
  doc_number text,                  -- e.g. GL24PR-00000210
  entity_name text,
  description text,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  dept_name text,
  memo text,
  category text not null            -- MGMT_FEE / SHARE_ADMIN / SHARE_IT / SHARE_MGT / DN_PROPERTY / DN_ADVERTISING / IC_INVOICE_BILL / DN_OTHER
);
create index if not exists alloc_txn_ledger_ym_sub on alloc_txn_ledger (ym, subsidiary_id);

alter table alloc_txn_ledger enable row level security;
create policy alloc_txn_ledger_read on alloc_txn_ledger for select using (auth.uid() is not null);
create policy alloc_txn_ledger_write on alloc_txn_ledger for all using (app_role() in ('owner', 'accountant'));

-- 前端用嘅彙總（security_invoker：沿用 base table RLS）
create or replace view alloc_txn_summary with (security_invoker = true) as
select ym, subsidiary_id, acct_number, txn_type, category,
       sum(debit) as debit, sum(credit) as credit, count(*) as lines
from alloc_txn_ledger
group by ym, subsidiary_id, acct_number, txn_type, category;
