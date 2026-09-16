-- BU P&L / Cashflow 還原（Blueprint v0.1 §3.1–§3.2）
-- 新增：line-level P&L fact（含 inter-co 標記所需欄位）、BU cash fact、
-- reference / rules 表（bu_mapping、ic_entity_map、ic_account_map、
-- allocation_rules、headcount_monthly、account_group_map）。
-- 期間以 trandate 推算（accountingperiod 對現有 role 不可見）。

-- ── facts ────────────────────────────────────────────────────────────────────

-- 每月 × 公司 × department × account × 交易類型 × 集團 entity × 是否 IC journal
-- 的 P&L 合計。ic_flag 由 app 依 ic_entity_map / ic_account_map 推算，
-- 唔寫死喺 fact 入面（改對照表可即時重算）。
create table if not exists fact_bu_pl (
  ym text not null,                         -- 'YYYY-MM'（trandate）
  subsidiary_id int not null,
  department_id int not null default 0,     -- 0 = 未標 department
  account_id int not null,
  txn_type text not null,                   -- NetSuite transaction.type
  ic_entity_id int not null default 0,      -- 集團 customer/vendor entity；0 = 外部
  ic_journal boolean not null default false,-- Journal 同單有 Amount Due From/To 對手方
  debit numeric(16, 2) not null default 0,
  credit numeric(16, 2) not null default 0,
  lines int not null default 0,
  primary key (ym, subsidiary_id, department_id, account_id, txn_type, ic_entity_id, ic_journal)
);
create index if not exists fact_bu_pl_ym on fact_bu_pl (ym, subsidiary_id);

-- 客戶收款 / 供應商付款，按 payment link 連回 invoice / bill 行的 department
-- 比例分攤（§2.3 A）。amount 為 HKD（已乘 exchangerate）。
create table if not exists fact_bu_cash (
  ym text not null,
  subsidiary_id int not null,
  department_id int not null default 0,
  direction text not null check (direction in ('in', 'out')),
  ic_entity_id int not null default 0,
  amount numeric(16, 2) not null default 0,
  payments int not null default 0,
  primary key (ym, subsidiary_id, department_id, direction, ic_entity_id)
);

-- ── reference / rules（admin UI 維護；唔 hard-code）───────────────────────────

create table if not exists bu_mapping (
  id serial primary key,
  subsidiary_id int not null,
  department_id int,                        -- null = 該公司其餘 department 預設
  bu_code text not null,                    -- EPR / PROD / JM / CLS / SHARED / OTHER
  effective_from date not null default '2000-01-01',
  effective_to date,
  note text
);

create table if not exists ic_entity_map (
  entity_id int primary key,
  entity_type text not null check (entity_type in ('customer', 'vendor')),
  counterparty_subsidiary_id int,           -- null = related-party（非 NetSuite subsidiary）
  relation text not null check (relation in ('group', 'related_external')),
  name text,
  note text
);

create table if not exists ic_account_map (
  account_id int primary key,
  acctnumber text,
  ic_type text not null check (ic_type in ('MGMT_FEE', 'IC_BALANCE'))
);

create table if not exists allocation_rules (
  rule_id serial primary key,
  cost_pool text not null default 'SHARED',
  key_type text not null check (key_type in ('headcount', 'gp_share', 'revenue_share', 'fixed_pct')),
  label text not null,
  effective_from date not null default '2000-01-01',
  effective_to date,
  params jsonb not null default '{}'::jsonb,
  is_default boolean not null default false
);

create table if not exists headcount_monthly (
  ym text not null,
  bu_code text not null,
  headcount numeric(8, 2) not null,
  source text,
  primary key (ym, bu_code)
);

-- 管理帳 P&L 行次 override（預設由 report_group / acctnumber 推算）
create table if not exists account_group_map (
  account_id int primary key,
  mgmt_line text not null
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table fact_bu_pl enable row level security;
alter table fact_bu_cash enable row level security;
alter table bu_mapping enable row level security;
alter table ic_entity_map enable row level security;
alter table ic_account_map enable row level security;
alter table allocation_rules enable row level security;
alter table headcount_monthly enable row level security;
alter table account_group_map enable row level security;

create policy fact_bu_pl_read on fact_bu_pl for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy fact_bu_cash_read on fact_bu_cash for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy bu_mapping_read on bu_mapping for select using (auth.uid() is not null);
create policy ic_entity_map_read on ic_entity_map for select using (auth.uid() is not null);
create policy ic_account_map_read on ic_account_map for select using (auth.uid() is not null);
create policy allocation_rules_read on allocation_rules for select using (auth.uid() is not null);
create policy headcount_monthly_read on headcount_monthly for select using (auth.uid() is not null);
create policy account_group_map_read on account_group_map for select using (auth.uid() is not null);

create policy bu_mapping_write on bu_mapping for all using (app_role() in ('owner', 'accountant'));
create policy ic_entity_map_write on ic_entity_map for all using (app_role() in ('owner', 'accountant'));
create policy ic_account_map_write on ic_account_map for all using (app_role() in ('owner', 'accountant'));
create policy allocation_rules_write on allocation_rules for all using (app_role() in ('owner', 'accountant'));
create policy headcount_monthly_write on headcount_monthly for all using (app_role() in ('owner', 'accountant'));
create policy account_group_map_write on account_group_map for all using (app_role() in ('owner', 'accountant'));

-- ── seeds（Blueprint §2.1 BU 口徑、§3.2 對照表初始值）────────────────────────

insert into bu_mapping (subsidiary_id, department_id, bu_code, note) values
  -- CLS Garage：整間公司
  (5, null, 'CLS', 'CLS Garage 整間公司'),
  -- 704 Production：全部（扣 ePR Team）
  (8, null, 'PROD', '704 預設'),
  (8, 12, 'EPR', '704 內 ePR Team'),
  (8, 7, 'JM', '704 內 Monitoring and Seeding'),
  -- Jervois M：全部（扣 ePR Team）
  (7, null, 'JM', 'JM 預設'),
  (7, 12, 'EPR', 'JM 內 ePR Team'),
  (7, 2, 'PROD', 'JM 內 Production'),
  -- SSHK：扣 JS Sales Team、Monitoring and Seeding、Production
  (2, null, 'EPR', 'SSHK 預設'),
  (2, 17, 'OTHER', 'JS Sales Team（Jervois Solution，非集團 BU）'),
  (2, 7, 'JM', 'SSHK 內 Monitoring and Seeding'),
  (2, 2, 'PROD', 'SSHK 內 Production'),
  -- PBHK：admin / management 平台 + 各 BU dept
  (1, 6, 'SHARED', 'Admin, Finance, HR（待分攤）'),
  (1, 9, 'SHARED', 'Management（待分攤）'),
  (1, 11, 'SHARED', 'IT Department（待分攤）'),
  (1, 2, 'PROD', 'PBHK 內 Production'),
  (1, 12, 'EPR', 'PBHK 內 ePR Team'),
  (1, 7, 'JM', 'PBHK 內 Monitoring and Seeding'),
  (1, 18, 'OTHER', 'Pro Health'),
  (1, 17, 'OTHER', 'JS Sales Team'),
  (1, 16, 'OTHER', 'Travel Agency'),
  (1, 0, 'OTHER', '未標 department（§7.1 每季 240,000 待確認）'),
  (1, null, 'OTHER', 'PBHK 其餘'),
  -- 非核心 subsidiary
  (3, null, 'OTHER', 'CLS Production Limited'),
  (6, null, 'OTHER', 'Go Asia Plus Travel（NetSuite 內另一 subsidiary）'),
  (4, null, 'OTHER', 'Elimination');

insert into ic_entity_map (entity_id, entity_type, counterparty_subsidiary_id, relation, name) values
  (1447, 'customer', 2, 'group', 'Social Strategy Hong Kong Ltd.'),
  (1488, 'customer', 1, 'group', 'Photoblog.hk Ltd.'),
  (1489, 'customer', 1, 'group', 'Photoblog.hk Ltd.:Agent of Change Foundation-Social M. Mgt'),
  (2674, 'customer', 7, 'group', 'Jervois M Limited'),
  (2762, 'customer', 5, 'group', 'A/R to PB from CLS Garage'),
  (2763, 'customer', 7, 'group', 'A/R to PB from Jervois M'),
  (2792, 'customer', 2, 'group', 'Social Strategy Hong Kong Limited'),
  (2907, 'customer', 8, 'group', 'A/R to PB from 704 Production'),
  (3201, 'customer', 7, 'group', 'Jervois M Limited'),
  (3207, 'customer', 8, 'group', '704 Production Limited'),
  (3245, 'customer', null, 'related_external', 'A/R to PB from Jervois T'),
  (3584, 'customer', null, 'related_external', 'A/R to PB from Jervois X'),
  (3958, 'customer', 1, 'group', 'Photoblog.hk Limited'),
  (4113, 'customer', 6, 'related_external', 'A/R to PB from Go Asia'),
  (4468, 'customer', 1, 'group', 'Photoblog.hk'),
  (4576, 'customer', 5, 'group', 'CLS Garage'),
  (863, 'vendor', 2, 'group', 'Social Strategy Hong Kong Ltd'),
  (1027, 'vendor', 1, 'group', 'Photoblog.hk Ltd'),
  (2568, 'vendor', 3, 'group', 'A/P to CLS Production from CLS Garage'),
  (2714, 'vendor', 1, 'group', 'A/P to PB from CLS Garage'),
  (2873, 'vendor', 7, 'group', 'Jervois M Limited'),
  (3106, 'vendor', 1, 'group', 'A/P to PB from 704 Production'),
  (3328, 'vendor', 8, 'group', '704 Production Limited');

insert into ic_account_map (account_id, acctnumber, ic_type)
select id, acctnumber, 'MGMT_FEE' from dim_account where acctnumber in ('60000022', '81000059', '81000068')
union all
select id, acctnumber, 'IC_BALANCE' from dim_account where acctnumber like '250000%' or acctnumber like '35002%';

insert into allocation_rules (cost_pool, key_type, label, params, is_default) values
  ('SHARED', 'headcount', '人頭法（月結）', '{}'::jsonb, true),
  ('SHARED', 'gp_share', 'GP 比例（年結）', '{}'::jsonb, false),
  ('SHARED', 'revenue_share', '收入比例', '{}'::jsonb, false),
  ('SHARED', 'fixed_pct', '固定比例（FY24/25 年結 GP%）', '{"EPR": 58.52, "JM": 21.31, "PROD": 10.95, "CLS": 9.22}'::jsonb, false);

-- headcount 基線：2025-03 年結（docs/allocation-rules.md）；app 以最近一個 ≤ 月份的紀錄 carry forward
insert into headcount_monthly (ym, bu_code, headcount, source) values
  ('2025-03', 'EPR', 15, 'seed: 2025.03 allocation workbook (SSHK)'),
  ('2025-03', 'PROD', 5, 'seed: 2025.03 allocation workbook (704)'),
  ('2025-03', 'JM', 6, 'seed: 2025.03 allocation workbook (JM)'),
  ('2025-03', 'CLS', 2, 'seed: 2025.03 allocation workbook (CLS)'),
  ('2025-03', 'OTHER', 5, 'seed: Go Asia 1 + JS 4（associates，只分 Admin/IT pool）');
