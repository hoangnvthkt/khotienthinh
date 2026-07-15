-- Release B1: forward-only hardening for the reconciliation audit model.
-- The CLI-generated timestamp was moved past the already-committed 18:00 foundation migration.

alter table public.wms_reconciliation_runs
  add column if not exists scope_hash text,
  add column if not exists affected_from timestamptz,
  add column if not exists scan_started_at timestamptz,
  add column if not exists scan_completed_at timestamptz,
  add column if not exists apply_started_at timestamptz,
  add column if not exists apply_completed_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists error_text text;

create or replace function app_private.guard_wms_reconciliation_run_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_hash is not null
     and old.schema_hash is distinct from new.schema_hash then
    raise exception 'WMS reconciliation schema fingerprint is immutable'
      using errcode = '22023';
  end if;

  if old.function_hash is not null
     and old.function_hash is distinct from new.function_hash then
    raise exception 'WMS reconciliation function fingerprint is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_wms_reconciliation_run_fingerprints()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_wms_reconciliation_run_fingerprints
  on public.wms_reconciliation_runs;
create trigger trg_wms_reconciliation_run_fingerprints
before update on public.wms_reconciliation_runs
for each row
execute function app_private.guard_wms_reconciliation_run_fingerprints();

alter table public.wms_reconciliation_findings
  add column if not exists resolution_owner uuid references public.users(id) on delete set null,
  add column if not exists quarantine_reason text,
  add column if not exists raw_values jsonb not null default '{}'::jsonb;

alter table public.wms_reconciliation_findings
  add constraint wms_reconciliation_findings_type_check
  check (finding_type in (
    'DECIMAL_APPLY',
    'TX_LEDGER_MISSING',
    'TX_LEDGER_MISMATCH',
    'LEDGER_BALANCE_CACHE',
    'STOCK_CACHE_EXPECTED',
    'RESERVATION_CURRENT',
    'BATCH_TX',
    'PO_RECEIPT_UOM',
    'MR_RECEIPT',
    'PHYSICAL_ANCHOR',
    'UOM_PRECISION',
    'LINEAGE_GAP'
  )),
  add constraint wms_reconciliation_findings_severity_check
  check (severity in ('P0', 'P1', 'P2', 'P3')),
  add constraint wms_reconciliation_findings_confidence_check
  check (confidence in ('low', 'medium', 'high'));

alter table public.wms_reconciliation_approvals
  drop constraint if exists wms_reconciliation_approvals_kind_check;

update public.wms_reconciliation_approvals
set kind = 'wms'
where kind = 'cache';

alter table public.wms_reconciliation_approvals
  add constraint wms_reconciliation_approvals_kind_check
  check (kind in ('wms', 'business'));

create or replace function app_private.reject_wms_reconciliation_approval_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'WMS reconciliation approvals are append-only'
    using errcode = '55000';
end;
$$;

revoke all on function app_private.reject_wms_reconciliation_approval_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_wms_reconciliation_approvals_append_only
  on public.wms_reconciliation_approvals;
create trigger trg_wms_reconciliation_approvals_append_only
before update or delete on public.wms_reconciliation_approvals
for each row
execute function app_private.reject_wms_reconciliation_approval_mutation();

do $$
declare
  v_data_type text;
  v_constraint record;
begin
  select c.data_type
  into v_data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'wms_reconciliation_actions'
    and c.column_name = 'idempotency_key';

  if v_data_type is null then
    raise exception 'wms_reconciliation_actions.idempotency_key is missing'
      using errcode = 'P0002';
  end if;

  if v_data_type not in ('text', 'uuid') then
    raise exception 'Unsupported idempotency_key type: %', v_data_type
      using errcode = '22023';
  end if;

  if v_data_type = 'text' and exists (
    select 1
    from public.wms_reconciliation_actions a
    where a.idempotency_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) then
    raise exception 'Cannot convert non-UUID WMS reconciliation idempotency keys'
      using errcode = '22023';
  end if;

  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.wms_reconciliation_actions'::regclass
      and c.contype = 'u'
      and c.conkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'idempotency_key'
            and not a.attisdropped
        )
      ]::smallint[]
  loop
    execute pg_catalog.format(
      'alter table public.wms_reconciliation_actions drop constraint %I',
      v_constraint.conname
    );
  end loop;

  if v_data_type = 'text' then
    alter table public.wms_reconciliation_actions
      alter column idempotency_key type uuid using idempotency_key::uuid;
  end if;
end;
$$;

alter table public.wms_reconciliation_actions
  add constraint wms_reconciliation_actions_finding_idempotency_key_key
  unique (finding_id, idempotency_key);

create index if not exists idx_wms_reconciliation_runs_active
  on public.wms_reconciliation_runs(status, updated_at desc)
  where status in ('created', 'scanning', 'scanned', 'approved', 'applying', 'applied');

create index if not exists idx_wms_reconciliation_findings_open_stale
  on public.wms_reconciliation_findings(run_id, status, severity, warehouse_id, item_id)
  where status in ('open', 'stale');

create index if not exists idx_wms_reconciliation_approvals_approved_lookup
  on public.wms_reconciliation_approvals(finding_id, kind, actor_id, created_at desc)
  where decision = 'approved';

create table if not exists app_private.wms_reconciliation_settings (
  key text primary key
    check (key in ('scan_enabled', 'apply_enabled', 'rollback_enabled')),
  value boolean not null,
  updated_at timestamptz not null default pg_catalog.now()
);

insert into app_private.wms_reconciliation_settings (key, value)
values
  ('scan_enabled', true),
  ('apply_enabled', false),
  ('rollback_enabled', false)
on conflict (key) do nothing;

revoke all privileges on table app_private.wms_reconciliation_settings
  from public, anon, authenticated, service_role;

alter table public.wms_reconciliation_runs enable row level security;
alter table public.wms_reconciliation_findings enable row level security;
alter table public.wms_reconciliation_approvals enable row level security;
alter table public.wms_reconciliation_actions enable row level security;

revoke all privileges on table
  public.wms_reconciliation_runs,
  public.wms_reconciliation_findings,
  public.wms_reconciliation_approvals,
  public.wms_reconciliation_actions
from public, anon, authenticated, service_role;

insert into public.permission_modules (
  application_code,
  code,
  name,
  routes,
  legacy_module_key,
  sort_order
)
values (
  'wms',
  'wms.reconciliation',
  'Đối soát tồn kho',
  array['/wms/reconciliation']::text[],
  'WMS',
  35
)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order
)
values
  ('wms.reconciliation', 'view', 'wms.reconciliation.view', 'Xem', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', false, 10),
  ('wms.reconciliation', 'generate', 'wms.reconciliation.generate', 'Tạo run', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', true, 20),
  ('wms.reconciliation', 'approve_cache', 'wms.reconciliation.approve_cache', 'Duyệt sửa cache', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', true, 30),
  ('wms.reconciliation', 'approve_business', 'wms.reconciliation.approve_business', 'Duyệt nghiệp vụ', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', true, 40),
  ('wms.reconciliation', 'apply', 'wms.reconciliation.apply', 'Áp dụng', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', true, 50),
  ('wms.reconciliation', 'rollback', 'wms.reconciliation.rollback', 'Hoàn tác', array['global', 'warehouse']::text[], 'WMS', '/wms/reconciliation', true, 60)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true;
