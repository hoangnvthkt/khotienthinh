-- Release B foundation: auditable WMS reconciliation model.
create table if not exists public.wms_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  scope jsonb not null default '{}'::jsonb,
  as_of timestamptz not null,
  policy_version text not null,
  schema_hash text,
  function_hash text,
  cursor jsonb not null default '{}'::jsonb,
  run_hash text,
  status text not null default 'created' check (status in ('created','scanning','scanned','approved','applying','applied','verified','failed')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_reconciliation_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.wms_reconciliation_runs(id) on delete cascade,
  finding_type text not null,
  severity text not null default 'P2',
  confidence text not null default 'medium',
  item_id text,
  warehouse_id text,
  unit text,
  raw_value_text text,
  before_qty numeric(20,6),
  expected_qty numeric(20,6),
  delta_qty numeric(20,6),
  evidence jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  proposed_action text,
  precondition_hash text not null,
  status text not null default 'open' check (status in ('open','approved','rejected','applied','verified','quarantined','stale')),
  created_at timestamptz not null default now(),
  unique(run_id, finding_type, item_id, warehouse_id, precondition_hash)
);

create table if not exists public.wms_reconciliation_approvals (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.wms_reconciliation_findings(id) on delete cascade,
  kind text not null check (kind in ('cache','business')),
  decision text not null check (decision in ('approved','rejected')),
  reason text,
  actor_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.wms_reconciliation_actions (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.wms_reconciliation_findings(id) on delete cascade,
  idempotency_key text not null unique,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb,
  precondition_hash text not null,
  actor_id uuid not null default auth.uid(),
  result text not null default 'pending' check (result in ('pending','applied','verified','rolled_back','failed')),
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wms_reconciliation_findings_run_status on public.wms_reconciliation_findings(run_id, status, severity);
create index if not exists idx_wms_reconciliation_findings_scope on public.wms_reconciliation_findings(warehouse_id, item_id, status);
create index if not exists idx_wms_reconciliation_approvals_finding on public.wms_reconciliation_approvals(finding_id, kind, created_at desc);

alter table public.wms_reconciliation_runs enable row level security;
alter table public.wms_reconciliation_findings enable row level security;
alter table public.wms_reconciliation_approvals enable row level security;
alter table public.wms_reconciliation_actions enable row level security;
revoke all privileges on table public.wms_reconciliation_runs, public.wms_reconciliation_findings, public.wms_reconciliation_approvals, public.wms_reconciliation_actions from anon, authenticated;

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values ('wms', 'wms.reconciliation', 'Đối soát tồn kho', array['/wms/reconciliation']::text[], 'WMS', 35)
on conflict (code) do update set name = excluded.name, routes = excluded.routes, is_active = true;

insert into public.permission_actions (module_code, action, permission_code, label, scope_modes, legacy_module_key, legacy_route, legacy_admin_only, sort_order)
values
 ('wms.reconciliation','view','wms.reconciliation.view','Xem',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,10),
 ('wms.reconciliation','generate','wms.reconciliation.generate','Tạo run',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,20),
 ('wms.reconciliation','approve_cache','wms.reconciliation.approve_cache','Duyệt sửa cache',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,30),
 ('wms.reconciliation','approve_business','wms.reconciliation.approve_business','Duyệt nghiệp vụ',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,40),
 ('wms.reconciliation','apply','wms.reconciliation.apply','Áp dụng',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,50),
 ('wms.reconciliation','rollback','wms.reconciliation.rollback','Hoàn tác',array['global','warehouse']::text[],'WMS','/wms/reconciliation',true,60)
on conflict (permission_code) do update set label = excluded.label, is_active = true;
