-- BU 管理帳：加入 NetSuite class 維度（Production department 內 YouTube class 要分開兩條數）
-- 2026-09-29 已 apply 到 Supabase（migration 0006_bu_class_dimension）。
alter table fact_bu_pl add column if not exists class_id int not null default 0;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.fact_bu_pl'::regclass and contype = 'p';
  if c is not null then execute format('alter table public.fact_bu_pl drop constraint %I', c); end if;
end $$;
alter table fact_bu_pl add primary key (ym, subsidiary_id, department_id, class_id, account_id, txn_type, ic_entity_id, ic_journal);

alter table fact_bu_cash add column if not exists class_id int not null default 0;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.fact_bu_cash'::regclass and contype = 'p';
  if c is not null then execute format('alter table public.fact_bu_cash drop constraint %I', c); end if;
end $$;
alter table fact_bu_cash add primary key (ym, subsidiary_id, department_id, class_id, direction, ic_entity_id);

create table if not exists dim_class (
  id int primary key,
  name text not null,
  parent_id int,
  is_inactive boolean not null default false
);
alter table dim_class enable row level security;
drop policy if exists dim_class_read on dim_class;
create policy dim_class_read on dim_class for select using (auth.uid() is not null);

-- bu_mapping：class_id null = 該 department 所有 class；有值 = 只限該 class（優先於 department 規則）
alter table bu_mapping add column if not exists class_id int;
