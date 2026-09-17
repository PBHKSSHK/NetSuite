-- BU 還原 v0.2：會計 allocation worksheet 規則（2026-09-17）
--  * gp_share_monthly：每月各 BU GP%（2 allocation.xlsx「GP%」）—— Admin/IT/Mgt pool 分攤 key
--  * director_alloc_monthly：老闆人工按 BU 報表口徑（「director」sheet）+ 帳面 ledger
--  * headcount_monthly：改為逐月 by BU（含 JS / Go Asia associates）
--  * tax_saving_adjustments：年結 tax planning inter-co 開單清單（正 = 開單方、負 = 被扣方）
--  * bu_reclass_rules：account 層級 reclass（例：2021-04..09 PBHK Sales dept 人工 → CLS）
--  * ic_entity_map：補齊集團 / related-party entity
--  * allocation_rules：新增 key_type 'workbook'（官方方法）

create table if not exists gp_share_monthly (
  ym text not null,
  bu_code text not null,            -- worksheet 欄：PROD_PB / YT / PROD_704 / EPR / EPR_COMM / CLS / JM
  pct numeric(8, 4) not null,
  primary key (ym, bu_code)
);

create table if not exists director_alloc_monthly (
  ym text not null,
  bu_code text not null,
  amount numeric(14, 2) not null,   -- BU 報表口徑（含 MPF）
  ledger_salary numeric(14, 2) not null default 0,
  ledger_mpf numeric(14, 2) not null default 0,
  primary key (ym, bu_code)
);

create table if not exists tax_saving_adjustments (
  id serial primary key,
  fy text not null,
  nature text not null,
  subsidiary_id int not null,
  amount numeric(14, 2) not null    -- 正 = 開單（收入）方；負 = 被扣方
);

create table if not exists bu_reclass_rules (
  id serial primary key,
  subsidiary_id int not null,
  department_id int,                -- null = 任何 department
  acct_prefixes text[],             -- null = 任何 account；否則 acctnumber 前綴
  effective_from date not null,
  effective_to date,
  bu_code text not null,
  note text
);

alter table gp_share_monthly enable row level security;
alter table director_alloc_monthly enable row level security;
alter table tax_saving_adjustments enable row level security;
alter table bu_reclass_rules enable row level security;
create policy gp_share_monthly_read on gp_share_monthly for select using (auth.uid() is not null);
create policy director_alloc_monthly_read on director_alloc_monthly for select using (auth.uid() is not null);
create policy tax_saving_adjustments_read on tax_saving_adjustments for select using (auth.uid() is not null);
create policy bu_reclass_rules_read on bu_reclass_rules for select using (auth.uid() is not null);
create policy gp_share_monthly_write on gp_share_monthly for all using (app_role() in ('owner', 'accountant'));
create policy director_alloc_monthly_write on director_alloc_monthly for all using (app_role() in ('owner', 'accountant'));
create policy tax_saving_adjustments_write on tax_saving_adjustments for all using (app_role() in ('owner', 'accountant'));
create policy bu_reclass_rules_write on bu_reclass_rules for all using (app_role() in ('owner', 'accountant'));

alter table allocation_rules drop constraint if exists allocation_rules_key_type_check;
alter table allocation_rules add constraint allocation_rules_key_type_check
  check (key_type in ('workbook', 'headcount', 'gp_share', 'revenue_share', 'fixed_pct'));
update allocation_rules set is_default = false;
insert into allocation_rules (cost_pool, key_type, label, params, is_default) values
  ('SHARED', 'workbook', '會計 worksheet（Admin/IT 扣 JS+Go Asia 人頭，再按 GP%；Mgt 100% GP%）', '{}'::jsonb, true);

-- 2021-04 → 2021-09 PBHK Sales dept 代 CLS Garage 支付人工（$180,673.37）及 MPF（$9,033.67）
insert into bu_reclass_rules (subsidiary_id, department_id, acct_prefixes, effective_from, effective_to, bu_code, note) values
  (1, 8, array['81000084', '81000063'], '2021-04-01', '2021-09-30', 'CLS', 'PBHK (Sales) 代 CLS Garage 支付人工 180,673.37 + MPF 9,033.67，還原去 CLS BU');

-- 補齊 IC entity（NetSuite customer / vendor 名稱含集團公司）
insert into ic_entity_map (entity_id, entity_type, counterparty_subsidiary_id, relation, name) values
  (1517, 'customer', 5, 'group', 'A/R to PB from CLS (no use)'),
  (1518, 'customer', 2, 'group', 'A/R to PB from SSHK'),
  (1521, 'customer', 1, 'group', 'A/R to SSHK from PB'),
  (1522, 'customer', 5, 'group', 'A/R to SSHK from CLS (no use)'),
  (1767, 'customer', 3, 'group', 'CLS Production Limited'),
  (1524, 'vendor', 1, 'group', 'A/P to PB from SSHK'),
  (1525, 'vendor', 5, 'group', 'A/P to CLS from PB'),
  (1526, 'vendor', 5, 'group', 'A/P to CLS from SSHK'),
  (1527, 'vendor', 2, 'group', 'A/P to SSHK from PB'),
  (1545, 'vendor', 3, 'group', 'CLS Production Limited'),
  (2930, 'vendor', 1, 'group', 'A/P to PB from JM'),
  (1402, 'customer', null, 'related_external', 'Jervois One (Hong Kong) Ltd'),
  (2432, 'customer', null, 'related_external', 'Jervois One (Hong Kong) Ltd'),
  (2789, 'customer', null, 'related_external', 'Jervois One (Hong Kong) Ltd'),
  (3511, 'customer', null, 'related_external', 'Jervois Solution Limited'),
  (3634, 'customer', null, 'related_external', 'Jervois Finance'),
  (4087, 'customer', 6, 'related_external', 'Go Asia Plus Travel & Tours Co. Limited'),
  (4126, 'customer', null, 'related_external', 'JERVOIS SOLUTIONS LIMITED'),
  (4399, 'customer', null, 'related_external', 'Jervois Solutions Limited'),
  (762, 'vendor', null, 'related_external', 'Jervois One (Hong Kong) Limited'),
  (3626, 'vendor', null, 'related_external', 'Jervois Solutions Limited'),
  (4623, 'vendor', 6, 'related_external', 'Go Asia Plus Travel & Tours Co.')
on conflict (entity_id) do nothing;

-- Seeds（headcount / GP% / director / tax saving）見 packages/sync/reference/0003_seed_allocation_reference.sql
