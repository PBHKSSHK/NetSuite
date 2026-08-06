-- 集團管理 Dashboard — initial schema (blueprint §3)
-- All fact tables key on NetSuite internal ids for reconciliation.

-- ── dimensions ───────────────────────────────────────────────────────────────

create table dim_subsidiary (
  id int primary key, -- NetSuite subsidiary internal id
  name text not null,
  is_elimination boolean not null default false
);

insert into dim_subsidiary (id, name, is_elimination) values
  (1, 'Photoblog.hk Limited', false),
  (2, 'Social Strategy Hong Kong Limited', false),
  (5, 'CLS GARAGE', false),
  (7, 'Jervois M Limited', false),
  (8, '704 Production Limited', false),
  (4, 'Elimination', true);

create table dim_account (
  id int primary key, -- NetSuite account internal id
  acctnumber text,
  fullname text not null,
  accttype text not null,
  parent_id int references dim_account (id),
  report_group_id int -- fk added after report_group
);

create table report_group (
  id serial primary key,
  code text not null unique, -- e.g. REV_SERVICE, COS_SERVICES, OPEX_STAFF
  label text not null,
  statement text not null check (statement in ('PL', 'BS')),
  sort_order int not null
);

alter table dim_account
  add constraint dim_account_report_group_fk
  foreign key (report_group_id) references report_group (id);

create table dim_department (
  id int primary key, -- NetSuite department internal id
  name text not null,
  is_allocatable boolean not null default false -- true for dept 6 / 9 / 11
);

create table dim_customer (
  id int primary key,
  name text not null
);

create table dim_project (
  id int primary key,
  name text not null,
  customer_id int references dim_customer (id)
);

create table dim_period (
  id int primary key, -- NetSuite accountingperiod internal id
  fy_label text not null, -- e.g. FY2026/27
  fy_month_no int not null check (fy_month_no between 1 and 12), -- April = 1
  start_date date not null,
  end_date date not null
);

-- ── facts ────────────────────────────────────────────────────────────────────

create table fact_gl (
  period_id int not null references dim_period (id),
  subsidiary_id int not null references dim_subsidiary (id),
  account_id int not null references dim_account (id),
  department_id int references dim_department (id),
  entity_id int,
  project_id int references dim_project (id),
  debit numeric(16, 2) not null default 0,
  credit numeric(16, 2) not null default 0,
  primary key (period_id, subsidiary_id, account_id, department_id, entity_id, project_id)
);

create index fact_gl_period_sub on fact_gl (period_id, subsidiary_id);
create index fact_gl_account on fact_gl (account_id);

create table fact_ar_open (
  txn_id int primary key,
  subsidiary_id int not null references dim_subsidiary (id),
  customer_id int,
  tranid text,
  trandate date,
  duedate date,
  amount_open numeric(16, 2) not null,
  currency text
);

create table fact_ap_open (
  txn_id int primary key,
  subsidiary_id int not null references dim_subsidiary (id),
  vendor_id int,
  tranid text,
  trandate date,
  duedate date,
  amount_open numeric(16, 2) not null,
  currency text
);

create table fact_bank_balance_daily (
  as_of_date date not null,
  subsidiary_id int not null references dim_subsidiary (id),
  account_id int not null,
  balance numeric(16, 2) not null,
  primary key (as_of_date, subsidiary_id, account_id)
);

create table fact_payroll_monthly (
  period_id int not null references dim_period (id),
  subsidiary_id int not null references dim_subsidiary (id),
  department_id int references dim_department (id),
  employee_count int,
  basic_salary numeric(16, 2),
  mpf_er numeric(16, 2),
  mpf_ee numeric(16, 2),
  total_cost numeric(16, 2),
  primary key (period_id, subsidiary_id, department_id)
);

-- ── app tables ───────────────────────────────────────────────────────────────

create table budget_lines (
  fy text not null,
  version text not null check (version in ('ORIGINAL', 'FORECAST')),
  subsidiary_id int not null references dim_subsidiary (id),
  report_group_id int not null references report_group (id),
  department_id int references dim_department (id), -- reserved for dept-level budgets
  month_no int not null check (month_no between 1 and 12),
  amount numeric(16, 2) not null,
  primary key (fy, version, subsidiary_id, report_group_id, month_no)
);

create table alloc_rules (
  fy text not null,
  source_subsidiary_id int not null references dim_subsidiary (id),
  source_department_id int not null references dim_department (id),
  method text not null default 'GP_RATIO',
  target_subsidiary_ids int[] not null,
  primary key (fy, source_subsidiary_id, source_department_id)
);

create table recurring_cash_items (
  id serial primary key,
  subsidiary_id int not null references dim_subsidiary (id),
  label text not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(16, 2) not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  active boolean not null default true
);

create table sync_log (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  rows int,
  status text not null check (status in ('running', 'ok', 'error')),
  error text
);

create table user_profiles (
  user_id uuid primary key references auth.users (id),
  role text not null check (role in ('owner', 'accountant', 'manager')),
  subsidiary_ids int[] not null default '{}'
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- owner / accountant: all subsidiaries. manager: own subsidiary only.

alter table fact_gl enable row level security;
alter table fact_ar_open enable row level security;
alter table fact_ap_open enable row level security;
alter table fact_bank_balance_daily enable row level security;
alter table fact_payroll_monthly enable row level security;
alter table budget_lines enable row level security;
alter table user_profiles enable row level security;

create or replace function app_role() returns text language sql stable as $$
  select role from user_profiles where user_id = auth.uid()
$$;

create or replace function app_subsidiaries() returns int[] language sql stable as $$
  select subsidiary_ids from user_profiles where user_id = auth.uid()
$$;

create policy fact_gl_read on fact_gl for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy fact_ar_read on fact_ar_open for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy fact_ap_read on fact_ap_open for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy fact_bank_read on fact_bank_balance_daily for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy fact_payroll_read on fact_payroll_monthly for select using (
  app_role() in ('owner', 'accountant')
);
create policy budget_read on budget_lines for select using (
  app_role() in ('owner', 'accountant') or subsidiary_id = any (app_subsidiaries())
);
create policy budget_write on budget_lines for all using (app_role() = 'accountant');
create policy profile_self on user_profiles for select using (user_id = auth.uid());

-- dimensions are readable by all authenticated users
alter table dim_subsidiary enable row level security;
create policy dim_sub_read on dim_subsidiary for select using (auth.uid() is not null);
alter table dim_department enable row level security;
create policy dim_dept_read on dim_department for select using (auth.uid() is not null);
alter table report_group enable row level security;
create policy rg_read on report_group for select using (auth.uid() is not null);
