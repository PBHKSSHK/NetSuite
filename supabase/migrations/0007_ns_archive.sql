-- NetSuite 停用（2026-10-30）前最後全量導出：逐行 GL + 交易表頭 + 主檔原始 JSON。
-- 只供 service role 讀；唔影響 dashboard 現有 fact 表。見 packages/sync/netsuite-final-archive.md。
create schema if not exists ns_archive;

create table if not exists ns_archive.gl_line (
  txn_id      bigint not null,
  line_id     int    not null,
  book        int    not null default 1,
  tranid      text,
  txn_type    text,
  trandate    date,
  period_id   int,
  subsidiary_id int,
  account_id  int,
  department_id int,
  class_id    int,
  location_id int,
  line_entity_id bigint,
  header_entity_id bigint,
  line_memo   text,
  header_memo text,
  debit       numeric(18,2),
  credit      numeric(18,2),
  amount      numeric(18,2),
  foreign_amount numeric(18,2),
  currency_id int,
  exchange_rate numeric(18,8),
  status      text,
  created_date date,
  last_modified date,
  extracted_at timestamptz not null default now(),
  primary key (txn_id, line_id, book)
);
create index if not exists gl_line_period_sub on ns_archive.gl_line (period_id, subsidiary_id);
create index if not exists gl_line_trandate on ns_archive.gl_line (trandate);
create index if not exists gl_line_account on ns_archive.gl_line (account_id);

-- 主檔 / 表頭 / 未清項目：原始 SuiteQL 行照存（jsonb）
create table if not exists ns_archive.record (
  record_type text not null,
  id          text not null,
  data        jsonb not null,
  extracted_at timestamptz not null default now(),
  primary key (record_type, id)
);

create table if not exists ns_archive.run_log (
  id bigserial primary key,
  part text not null,
  window_from date,
  window_to date,
  rows int,
  debit numeric(18,2),
  credit numeric(18,2),
  status text not null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table ns_archive.gl_line enable row level security;
alter table ns_archive.record enable row level security;
alter table ns_archive.run_log enable row level security;
revoke all on schema ns_archive from anon, authenticated;
grant usage on schema ns_archive to service_role;
grant all on all tables in schema ns_archive to service_role;
grant all on all sequences in schema ns_archive to service_role;
