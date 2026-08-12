-- Governed, Member-only application membership foundation.
--
-- This migration intentionally supplies only the relation, catalog integrity,
-- audit/refresh primitives, read boundary, and private helpers. Preview/Apply
-- mutation commands are deliberately deferred to application_membership_commands.

create schema if not exists app_private;

alter table public.permission_applications
  add column if not exists member_assignable boolean not null default true;

insert into public.permission_applications (
  code,
  name,
  description,
  sort_order,
  is_active,
  member_assignable
)
values
  ('project', 'Dự án', 'Canonical product application: Project', 10, true, true),
  ('procurement', 'Mua hàng', 'Canonical product application: Procurement', 20, true, true),
  ('wms', 'Kho vật tư', 'Canonical product application: Warehouse management', 30, true, true),
  ('hrm', 'Nhân sự', 'Canonical product application: Human resources', 40, true, true),
  ('workflow', 'Quy trình', 'Canonical product application: Workflow', 50, true, true),
  ('request', 'Yêu cầu', 'Canonical product application: Requests', 60, true, true),
  ('expense', 'Chi phí', 'Canonical product application: Expenses', 70, true, true),
  ('asset', 'Tài sản', 'Canonical product application: Assets', 80, true, true),
  ('contract', 'Hợp đồng', 'Canonical product application: Contracts', 90, true, true),
  ('chat', 'Trao đổi', 'Canonical product application: Chat', 100, true, true),
  ('ai', 'Trợ lý AI', 'Canonical product application: AI assistant', 110, true, true),
  ('storage', 'Kho dữ liệu', 'Canonical product application: Storage', 120, true, true),
  ('kb', 'Kho tri thức', 'Canonical product application: Knowledge base', 130, true, true),
  ('analytics', 'Phân tích', 'Canonical product application: Analytics', 140, true, true),
  ('settings', 'Cài đặt hệ thống', 'Canonical product application: System settings', 150, true, false)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    member_assignable = excluded.member_assignable,
    updated_at = now();

-- Preserve old catalog rows for historical references, but remove them from
-- the active Member-assignment catalog if they are not canonical applications.
update public.permission_applications
set is_active = false,
    member_assignable = false,
    updated_at = now()
where code not in (
  'project', 'procurement', 'wms', 'hrm', 'workflow', 'request', 'expense',
  'asset', 'contract', 'chat', 'ai', 'storage', 'kb', 'analytics', 'settings'
);

alter table public.permission_actions
  add column if not exists access_application_code text;

-- Reset historic ownership, then restore only the exact codes reviewed in the
-- current application permission registry. Prefix matches are intentionally
-- avoided so a newly introduced action cannot become assignable by accident.
update public.permission_actions
set access_application_code = null,
    updated_at = now()
where access_application_code is not null;

with reviewed_action_applications(permission_code, application_code) as (
  values
    ('ai.assistant.use', 'ai'),
    ('ai.assistant.view', 'ai'),
    ('ai.executive.view', 'ai'),
    ('ai.report.generate', 'ai'),
    ('ai.report.view', 'ai'),
    ('analytics.export', 'analytics'),
    ('analytics.view', 'analytics'),
    ('asset.assignment.assign', 'asset'),
    ('asset.assignment.return', 'asset'),
    ('asset.assignment.transfer', 'asset'),
    ('asset.assignment.view', 'asset'),
    ('asset.audit.export', 'asset'),
    ('asset.audit.perform', 'asset'),
    ('asset.audit.view', 'asset'),
    ('asset.catalog.create', 'asset'),
    ('asset.catalog.delete', 'asset'),
    ('asset.catalog.dispose', 'asset'),
    ('asset.catalog.edit', 'asset'),
    ('asset.catalog.import', 'asset'),
    ('asset.catalog.manage', 'asset'),
    ('asset.catalog.transfer_stock', 'asset'),
    ('asset.catalog.view', 'asset'),
    ('asset.maintenance.complete', 'asset'),
    ('asset.maintenance.create', 'asset'),
    ('asset.maintenance.import', 'asset'),
    ('asset.maintenance.manage', 'asset'),
    ('asset.maintenance.view', 'asset'),
    ('contract.cost_library.manage', 'contract'),
    ('contract.cost_library.view', 'contract'),
    ('contract.customer.manage', 'contract'),
    ('contract.customer.view', 'contract'),
    ('contract.partner.manage', 'contract'),
    ('contract.partner.view', 'contract'),
    ('contract.supplier.manage', 'contract'),
    ('contract.supplier.view', 'contract'),
    ('contract.template.manage', 'contract'),
    ('contract.template.view', 'contract'),
    ('expense.budget.create', 'expense'),
    ('expense.budget.edit_all', 'expense'),
    ('expense.budget.view', 'expense'),
    ('expense.expense_record.approve', 'expense'),
    ('expense.expense_record.create', 'expense'),
    ('expense.expense_record.edit_own', 'expense'),
    ('expense.expense_record.view', 'expense'),
    ('expense.expense_record.view_all', 'expense'),
    ('expense.expense_record.view_own', 'expense'),
    ('expense.master_data.manage', 'expense'),
    ('expense.master_data.view', 'expense'),
    ('hrm.attendance.edit', 'hrm'),
    ('hrm.attendance.view', 'hrm'),
    ('hrm.employee.create', 'hrm'),
    ('hrm.employee.edit', 'hrm'),
    ('hrm.employee.view', 'hrm'),
    ('hrm.leave.approve', 'hrm'),
    ('hrm.leave.view', 'hrm'),
    ('hrm.master_data.manage', 'hrm'),
    ('hrm.master_data.view', 'hrm'),
    ('hrm.payroll.manage', 'hrm'),
    ('hrm.payroll.view', 'hrm'),
    ('kb.manage', 'kb'),
    ('kb.view', 'kb'),
    ('project.budget.edit', 'project'),
    ('project.budget.manage', 'project'),
    ('project.budget.view', 'project'),
    ('project.cashflow.manage', 'project'),
    ('project.cashflow.view', 'project'),
    ('project.contract_item.edit', 'project'),
    ('project.contract_item.manage', 'project'),
    ('project.contract_item.view', 'project'),
    ('project.contract_variation.approve', 'project'),
    ('project.contract_variation.create', 'project'),
    ('project.contract_variation.manage', 'project'),
    ('project.contract_variation.submit', 'project'),
    ('project.contract_variation.verify', 'project'),
    ('project.contract_variation.view', 'project'),
    ('project.contract.approve', 'project'),
    ('project.contract.create', 'project'),
    ('project.contract.edit_all', 'project'),
    ('project.contract.manage', 'project'),
    ('project.contract.view', 'project'),
    ('project.custom_material.approve', 'project'),
    ('project.custom_material.create', 'project'),
    ('project.custom_material.manage', 'project'),
    ('project.custom_material.view', 'project'),
    ('project.daily_log.approve', 'project'),
    ('project.daily_log.confirm', 'project'),
    ('project.daily_log.create', 'project'),
    ('project.daily_log.delete_all', 'project'),
    ('project.daily_log.delete_own', 'project'),
    ('project.daily_log.edit_all', 'project'),
    ('project.daily_log.edit_own', 'project'),
    ('project.daily_log.manage', 'project'),
    ('project.daily_log.return', 'project'),
    ('project.daily_log.submit', 'project'),
    ('project.daily_log.summarize', 'project'),
    ('project.daily_log.verify', 'project'),
    ('project.daily_log.view', 'project'),
    ('project.dashboard.manage', 'project'),
    ('project.dashboard.view', 'project'),
    ('project.dashboard.view_financials', 'project'),
    ('project.dashboard.view_progress', 'project'),
    ('project.dashboard.view_risk', 'project'),
    ('project.documents.approve', 'project'),
    ('project.documents.delete', 'project'),
    ('project.documents.delete_all', 'project'),
    ('project.documents.delete_own', 'project'),
    ('project.documents.edit_metadata', 'project'),
    ('project.documents.manage', 'project'),
    ('project.documents.upload', 'project'),
    ('project.documents.view', 'project'),
    ('project.executive.manage', 'project'),
    ('project.executive.view', 'project'),
    ('project.gantt.approve_completion', 'project'),
    ('project.gantt.assign_task', 'project'),
    ('project.gantt.create_task', 'project'),
    ('project.gantt.edit', 'project'),
    ('project.gantt.edit_task', 'project'),
    ('project.gantt.manage', 'project'),
    ('project.gantt.submit_completion', 'project'),
    ('project.gantt.verify_completion', 'project'),
    ('project.gantt.view', 'project'),
    ('project.master.create', 'project'),
    ('project.master.edit', 'project'),
    ('project.master.hide', 'project'),
    ('project.master.manage', 'project'),
    ('project.master.manage_categories', 'project'),
    ('project.master.restore', 'project'),
    ('project.master.view', 'project'),
    ('project.material_boq.delete', 'project'),
    ('project.material_boq.edit', 'project'),
    ('project.material_boq.manage', 'project'),
    ('project.material_boq.view', 'project'),
    ('project.material_plan.edit', 'project'),
    ('project.material_plan.manage', 'project'),
    ('project.material_plan.view', 'project'),
    ('project.material_po.approve', 'project'),
    ('project.material_po.create', 'project'),
    ('project.material_po.delete', 'project'),
    ('project.material_po.manage', 'project'),
    ('project.material_po.receive', 'project'),
    ('project.material_po.view', 'project'),
    ('project.material_request.approve', 'project'),
    ('project.material_request.confirm', 'project'),
    ('project.material_request.confirm_fulfillment', 'project'),
    ('project.material_request.create', 'project'),
    ('project.material_request.delete_all', 'project'),
    ('project.material_request.delete_own', 'project'),
    ('project.material_request.edit_all', 'project'),
    ('project.material_request.edit_own', 'project'),
    ('project.material_request.manage', 'project'),
    ('project.material_request.return', 'project'),
    ('project.material_request.submit', 'project'),
    ('project.material_request.verify', 'project'),
    ('project.material_request.view', 'project'),
    ('project.material_request.view_available_stock', 'project'),
    ('project.material_waste.approve', 'project'),
    ('project.material_waste.manage', 'project'),
    ('project.material_waste.record', 'project'),
    ('project.material_waste.view', 'project'),
    ('project.org.assign_staff', 'project'),
    ('project.org.grant_permissions', 'project'),
    ('project.org.manage', 'project'),
    ('project.org.view', 'project'),
    ('project.overview.manage', 'project'),
    ('project.overview.view', 'project'),
    ('project.payment.approve', 'project'),
    ('project.payment.confirm', 'project'),
    ('project.payment.create', 'project'),
    ('project.payment.delete_all', 'project'),
    ('project.payment.delete_own', 'project'),
    ('project.payment.edit_all', 'project'),
    ('project.payment.edit_own', 'project'),
    ('project.payment.manage', 'project'),
    ('project.payment.mark_paid', 'project'),
    ('project.payment.return', 'project'),
    ('project.payment.submit', 'project'),
    ('project.payment.verify', 'project'),
    ('project.payment.view', 'project'),
    ('project.quality.approve', 'project'),
    ('project.quality.checklist_create', 'project'),
    ('project.quality.checklist_edit_all', 'project'),
    ('project.quality.checklist_edit_own', 'project'),
    ('project.quality.confirm', 'project'),
    ('project.quality.create', 'project'),
    ('project.quality.delete', 'project'),
    ('project.quality.delete_all', 'project'),
    ('project.quality.delete_own', 'project'),
    ('project.quality.edit_all', 'project'),
    ('project.quality.edit_own', 'project'),
    ('project.quality.manage', 'project'),
    ('project.quality.return', 'project'),
    ('project.quality.submit', 'project'),
    ('project.quality.template_manage', 'project'),
    ('project.quality.verify', 'project'),
    ('project.quality.view', 'project'),
    ('project.quantity_acceptance.approve', 'project'),
    ('project.quantity_acceptance.create', 'project'),
    ('project.quantity_acceptance.manage', 'project'),
    ('project.quantity_acceptance.submit', 'project'),
    ('project.quantity_acceptance.verify', 'project'),
    ('project.quantity_acceptance.view', 'project'),
    ('project.report.export', 'project'),
    ('project.report.view', 'project'),
    ('project.safety.approve', 'project'),
    ('project.safety.create', 'project'),
    ('project.safety.document_verify', 'project'),
    ('project.safety.edit_all', 'project'),
    ('project.safety.issue_close', 'project'),
    ('project.safety.issue_create', 'project'),
    ('project.safety.issue_edit_all', 'project'),
    ('project.safety.issue_edit_own', 'project'),
    ('project.safety.manage', 'project'),
    ('project.safety.training_manage', 'project'),
    ('project.safety.verify', 'project'),
    ('project.safety.view', 'project'),
    ('project.safety.worker_manage', 'project'),
    ('project.subcontract.approve', 'project'),
    ('project.subcontract.create', 'project'),
    ('project.subcontract.edit_all', 'project'),
    ('project.subcontract.manage', 'project'),
    ('project.subcontract.view', 'project'),
    ('project.weekly_progress.approve', 'project'),
    ('project.weekly_progress.create', 'project'),
    ('project.weekly_progress.edit_all', 'project'),
    ('project.weekly_progress.lock', 'project'),
    ('project.weekly_progress.manage', 'project'),
    ('project.weekly_progress.submit', 'project'),
    ('project.weekly_progress.verify', 'project'),
    ('project.weekly_progress.view', 'project'),
    ('request.category.manage', 'request'),
    ('request.category.view', 'request'),
    ('request.instance.act_assigned', 'request'),
    ('request.instance.create', 'request'),
    ('request.instance.view', 'request'),
    ('request.instance.view_all', 'request'),
    ('request.instance.view_own', 'request'),
    ('request.template.manage', 'request'),
    ('request.template.view', 'request'),
    ('storage.manage', 'storage'),
    ('storage.view', 'storage'),
    ('system.ai.manage', 'ai'),
    ('system.ai.view', 'ai'),
    ('system.analytics.manage', 'analytics'),
    ('system.analytics.view', 'analytics'),
    ('system.audit_trail.manage', 'settings'),
    ('system.audit_trail.view', 'settings'),
    ('system.authorization.audit', 'settings'),
    ('system.authorization.manage_grants', 'settings'),
    ('system.authorization.manage_roles', 'settings'),
    ('system.authorization.manage_scopes', 'settings'),
    ('system.authorization.override', 'settings'),
    ('system.authorization.view', 'settings'),
    ('system.chat.manage', 'chat'),
    ('system.chat.view', 'chat'),
    ('system.custom_dashboard.manage', 'analytics'),
    ('system.custom_dashboard.view', 'analytics'),
    ('system.da.manage', 'project'),
    ('system.da.view', 'project'),
    ('system.ep.manage', 'hrm'),
    ('system.ep.view', 'hrm'),
    ('system.ex.manage', 'expense'),
    ('system.ex.view', 'expense'),
    ('system.hd.manage', 'contract'),
    ('system.hd.view', 'contract'),
    ('system.hrm.manage', 'hrm'),
    ('system.hrm.view', 'hrm'),
    ('system.kb.manage', 'kb'),
    ('system.kb.view', 'kb'),
    ('system.procurement.manage', 'procurement'),
    ('system.procurement.view', 'procurement'),
    ('system.rq.manage', 'request'),
    ('system.rq.view', 'request'),
    ('system.settings.manage', 'settings'),
    ('system.settings.view', 'settings'),
    ('system.storage.manage', 'storage'),
    ('system.storage.view', 'storage'),
    ('system.tender_ai.manage', 'ai'),
    ('system.tender_ai.view', 'ai'),
    ('system.ts.manage', 'asset'),
    ('system.ts.view', 'asset'),
    ('system.wf.manage', 'workflow'),
    ('system.wf.view', 'workflow'),
    ('system.wms.manage', 'wms'),
    ('system.wms.view', 'wms'),
    ('wms.inventory.edit', 'wms'),
    ('wms.inventory.view', 'wms'),
    ('wms.master_data.manage', 'wms'),
    ('wms.master_data.view', 'wms'),
    ('wms.request.approve', 'wms'),
    ('wms.request.create', 'wms'),
    ('wms.request.export', 'wms'),
    ('wms.request.receive', 'wms'),
    ('wms.request.view', 'wms'),
    ('wms.transaction.approve', 'wms'),
    ('wms.transaction.complete', 'wms'),
    ('wms.transaction.create', 'wms'),
    ('wms.transaction.view', 'wms'),
    ('workflow.instance.act_assigned', 'workflow'),
    ('workflow.instance.create', 'workflow'),
    ('workflow.instance.view', 'workflow'),
    ('workflow.template.create', 'workflow'),
    ('workflow.template.edit', 'workflow'),
    ('workflow.template.publish', 'workflow'),
    ('workflow.template.view', 'workflow')
)
update public.permission_actions action_row
set access_application_code = reviewed_row.application_code,
    updated_at = now()
from reviewed_action_applications reviewed_row
where reviewed_row.permission_code = action_row.permission_code;

-- Unreviewed historical actions remain retained but cannot participate in a
-- new active authorization surface until their owning product application is
-- reviewed and backfilled.
update public.permission_actions
set is_active = false,
    updated_at = now()
where is_active
  and access_application_code is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.permission_actions'::regclass
      and conname = 'permission_actions_access_application_code_fkey'
  ) then
    alter table public.permission_actions
      add constraint permission_actions_access_application_code_fkey
      foreign key (access_application_code)
      references public.permission_applications(code)
      on update cascade
      on delete restrict;
  end if;
end;
$$;

create table public.user_application_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  application_code text not null references public.permission_applications(code) on update cascade,
  status text not null default 'ACTIVE',
  granted_by uuid not null references public.users(id),
  granted_reason text not null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.users(id),
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_application_memberships_status_check
    check (status in ('ACTIVE', 'REVOKED')),
  constraint user_application_memberships_granted_reason_check
    check (char_length(btrim(granted_reason)) >= 5)
);

create unique index user_application_memberships_one_active
  on public.user_application_memberships(user_id, application_code)
  where status = 'ACTIVE';

create index user_application_memberships_active_user_idx
  on public.user_application_memberships(user_id, application_code)
  where status = 'ACTIVE';

create table public.user_authorization_refresh_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_authorization_refresh_events_event_type_check
    check (char_length(btrim(event_type)) >= 3)
);

create index user_authorization_refresh_events_user_created_idx
  on public.user_authorization_refresh_events(user_id, created_at desc);

create or replace function app_private.is_active_system_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) = 1
    and coalesce(bool_and(user_row.id = p_user_id), false)
    from public.users user_row
    where user_row.role = 'ADMIN'
      and user_row.is_active
      and user_row.account_status = 'ACTIVE';
$$;

create or replace function app_private.enforce_user_application_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
  v_application public.permission_applications%rowtype;
begin
  if new.status = 'REVOKED' then
    if new.revoked_by is null
      or nullif(btrim(coalesce(new.revoked_reason, '')), '') is null
      or char_length(btrim(new.revoked_reason)) < 5
      or new.revoked_at is null
    then
      raise exception 'Revoked membership requires revoked_by, revoked_reason, and revoked_at'
        using errcode = '23514';
    end if;
  elsif new.revoked_by is not null
    or new.revoked_reason is not null
    or new.revoked_at is not null
  then
    raise exception 'Active membership cannot contain revoke metadata'
      using errcode = '23514';
  end if;

  select * into v_target
  from public.users
  where id = new.user_id;

  if v_target.id is null
    or v_target.role is distinct from 'EMPLOYEE'
  then
    raise exception 'Membership rows require an EMPLOYEE target'
      using errcode = '23514';
  end if;

  if new.status = 'ACTIVE' then
    if not v_target.is_active
      or v_target.account_status <> 'ACTIVE'
    then
      raise exception 'Active membership requires an active target user'
        using errcode = '23514';
    end if;

    select * into v_application
    from public.permission_applications
    where code = new.application_code;

    if v_application.code is null
      or not v_application.is_active
      or not v_application.member_assignable
    then
      raise exception 'Active membership requires an active Member-assignable application'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create constraint trigger user_application_memberships_enforce_state
after insert or update on public.user_application_memberships
deferrable initially immediate
for each row
execute function app_private.enforce_user_application_membership();

create or replace function app_private.enforce_user_application_membership_role_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'EMPLOYEE'
    and new.role is distinct from 'EMPLOYEE'
    and exists (
      select 1
      from public.user_application_memberships membership_row
      where membership_row.user_id = new.id
        and membership_row.status = 'ACTIVE'
    )
  then
    raise exception 'An EMPLOYEE with active application memberships cannot change roles'
      using errcode = '23514';
  end if;

  if old.role is distinct from 'ADMIN'
    and new.role = 'ADMIN'
    and exists (
      select 1
      from public.user_application_memberships membership_row
      where membership_row.user_id = new.id
    )
  then
    raise exception 'An account with application membership history cannot become ADMIN'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger users_enforce_application_membership_role_transition
after update of role on public.users
for each row
execute function app_private.enforce_user_application_membership_role_transition();

create or replace function app_private.touch_user_application_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_application_memberships_set_updated_at
before update on public.user_application_memberships
for each row
execute function app_private.touch_user_application_membership();

create or replace function app_private.user_application_membership_is_effective(
  p_user_id uuid,
  p_application_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_application_memberships membership_row
    join public.users user_row on user_row.id = membership_row.user_id
    join public.permission_applications application_row on application_row.code = membership_row.application_code
    where membership_row.user_id = p_user_id
      and membership_row.application_code = p_application_code
      and membership_row.status = 'ACTIVE'
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
      and user_row.role = 'EMPLOYEE'
      and application_row.is_active
      and application_row.member_assignable
  );
$$;

create or replace function app_private.record_user_application_membership_audit(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type not in (
    'APPLICATION_MEMBERSHIP_GRANTED',
    'APPLICATION_MEMBERSHIP_REVOKED'
  ) then
    raise exception 'Unsupported application membership audit event type'
      using errcode = '22023';
  end if;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    metadata
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function app_private.emit_user_authorization_refresh(
  p_user_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if p_event_type not in (
    'APPLICATION_MEMBERSHIP_GRANTED',
    'APPLICATION_MEMBERSHIP_REVOKED'
  ) then
    raise exception 'Unsupported user authorization refresh event type'
      using errcode = '22023';
  end if;

  insert into public.user_authorization_refresh_events (
    user_id,
    event_type,
    metadata
  )
  values (
    p_user_id,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

alter table public.user_application_memberships enable row level security;
alter table public.user_authorization_refresh_events enable row level security;

create policy user_application_memberships_select_own_active
on public.user_application_memberships
for select
to authenticated
using (
  user_id = (select public.current_app_user_id())
  and status = 'ACTIVE'
);

create policy user_authorization_refresh_events_select_own
on public.user_authorization_refresh_events
for select
to authenticated
using (user_id = (select public.current_app_user_id()));

revoke all on table public.user_application_memberships from public, anon, authenticated;
grant select on table public.user_application_memberships to authenticated;
grant all on table public.user_application_memberships to service_role;

revoke all on table public.user_authorization_refresh_events from public, anon, authenticated;
grant select on table public.user_authorization_refresh_events to authenticated;
grant all on table public.user_authorization_refresh_events to service_role;

revoke insert, update, delete, truncate on table public.permission_audit_events from public, anon, authenticated;

revoke all on function app_private.is_active_system_admin(uuid) from public, anon, authenticated;
revoke all on function app_private.enforce_user_application_membership() from public, anon, authenticated;
revoke all on function app_private.enforce_user_application_membership_role_transition() from public, anon, authenticated;
revoke all on function app_private.touch_user_application_membership() from public, anon, authenticated;
revoke all on function app_private.user_application_membership_is_effective(uuid, text) from public, anon, authenticated;
revoke all on function app_private.record_user_application_membership_audit(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.emit_user_authorization_refresh(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.list_user_application_memberships(
  p_target_user_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  application_code text,
  status text,
  granted_by uuid,
  granted_reason text,
  granted_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_target_user_id is null then
    if app_private.is_active_system_admin(v_actor_user_id) then
      return query
      select membership_row.id,
             membership_row.user_id,
             membership_row.application_code,
             membership_row.status,
             membership_row.granted_by,
             membership_row.granted_reason,
             membership_row.granted_at,
             membership_row.revoked_by,
             membership_row.revoked_reason,
             membership_row.revoked_at,
             membership_row.created_at,
             membership_row.updated_at
      from public.user_application_memberships membership_row
      order by membership_row.user_id, membership_row.application_code, membership_row.granted_at;
    else
      return query
      select membership_row.id,
             membership_row.user_id,
             membership_row.application_code,
             membership_row.status,
             membership_row.granted_by,
             membership_row.granted_reason,
             membership_row.granted_at,
             membership_row.revoked_by,
             membership_row.revoked_reason,
             membership_row.revoked_at,
             membership_row.created_at,
             membership_row.updated_at
      from public.user_application_memberships membership_row
      where membership_row.user_id = v_actor_user_id
        and membership_row.status = 'ACTIVE'
      order by membership_row.application_code, membership_row.granted_at;
    end if;
    return;
  end if;

  if p_target_user_id <> v_actor_user_id
    and not app_private.is_active_system_admin(v_actor_user_id)
  then
    raise exception 'not authorized to list another user''s memberships'
      using errcode = '42501';
  end if;

  return query
  select membership_row.id,
         membership_row.user_id,
         membership_row.application_code,
         membership_row.status,
         membership_row.granted_by,
         membership_row.granted_reason,
         membership_row.granted_at,
         membership_row.revoked_by,
         membership_row.revoked_reason,
         membership_row.revoked_at,
         membership_row.created_at,
         membership_row.updated_at
  from public.user_application_memberships membership_row
  where membership_row.user_id = p_target_user_id
    and (
      app_private.is_active_system_admin(v_actor_user_id)
      or membership_row.status = 'ACTIVE'
    )
  order by membership_row.application_code, membership_row.granted_at;
end;
$$;

revoke all on function public.list_user_application_memberships(uuid) from public, anon;
grant execute on function public.list_user_application_memberships(uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_authorization_refresh_events'
  ) then
    alter publication supabase_realtime add table public.user_authorization_refresh_events;
  end if;
end;
$$;
