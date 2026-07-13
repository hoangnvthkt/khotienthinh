-- Phase 4 ERP-wide permission surface smoke.
-- Run transactionally after Phase 1-4 permission migrations.

begin;

do $$
declare
  required_apps text[] := array[
    'wms',
    'hrm',
    'expense',
    'workflow',
    'request',
    'asset',
    'contract',
    'ai',
    'storage',
    'kb',
    'analytics'
  ];
  required_codes text[] := array[
    'wms.request.view',
    'wms.transaction.view',
    'wms.transaction.create',
    'wms.transaction.approve',
    'wms.transaction.complete',
    'expense.expense_record.view_own',
    'expense.expense_record.view_all',
    'expense.expense_record.create',
    'expense.expense_record.edit_own',
    'expense.expense_record.approve',
    'asset.assignment.view',
    'asset.maintenance.view',
    'asset.audit.view',
    'contract.template.view',
    'contract.cost_library.view',
    'ai.assistant.use',
    'ai.report.generate',
    'storage.view',
    'kb.manage',
    'analytics.export'
  ];
  app_code text;
  v_permission_code text;
begin
  foreach app_code in array required_apps loop
    if not exists (
      select 1
      from public.permission_applications pa
      where pa.code = app_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 4 permission application: %', app_code;
    end if;
  end loop;

  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 4 permission action: %', v_permission_code;
    end if;
  end loop;

  if to_regprocedure('public.has_permission(text,text,text)') is null then
    raise exception 'Missing public.has_permission(text,text,text)';
  end if;
  if to_regprocedure('public.has_any_permission(text[],text,text)') is null then
    raise exception 'Missing public.has_any_permission(text[],text,text)';
  end if;
  if to_regprocedure('public.assert_permission(text,text,text)') is null then
    raise exception 'Missing public.assert_permission(text,text,text)';
  end if;
  if to_regprocedure('app_private.wms_has_action(text,text,text,uuid,uuid,uuid)') is null then
    raise exception 'Missing app_private.wms_has_action(...)';
  end if;
  if to_regprocedure('app_private.expense_record_is_owner(text,uuid)') is null then
    raise exception 'Missing app_private.expense_record_is_owner(text,uuid)';
  end if;
  if to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null then
    raise exception 'Missing public.process_transaction_status(text,public.transaction_status,uuid)';
  end if;
end $$;

create temp table phase4_permission_smoke_ids (
  admin_id uuid not null,
  wms_creator_id uuid not null,
  wms_approver_id uuid not null,
  no_grant_id uuid not null,
  expense_owner_id uuid not null,
  expense_other_id uuid not null,
  expense_creator_id uuid not null,
  admin_email text not null,
  wms_creator_email text not null,
  wms_approver_email text not null,
  no_grant_email text not null,
  expense_owner_email text not null,
  expense_other_email text not null,
  expense_creator_email text not null,
  warehouse_a_id text not null,
  warehouse_b_id text not null,
  category_id uuid not null,
  owner_expense_id uuid not null,
  other_expense_id uuid not null,
  process_tx_id text not null
) on commit drop;

grant select, insert, update, delete on table phase4_permission_smoke_ids to authenticated;

insert into phase4_permission_smoke_ids
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase4-admin-smoke@vioo.local',
  'phase4-wms-creator-smoke@vioo.local',
  'phase4-wms-approver-smoke@vioo.local',
  'phase4-nogrant-smoke@vioo.local',
  'phase4-expense-owner-smoke@vioo.local',
  'phase4-expense-other-smoke@vioo.local',
  'phase4-expense-creator-smoke@vioo.local',
  'phase4-wh-a-' || gen_random_uuid()::text,
  'phase4-wh-b-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase4-process-tx-' || gen_random_uuid()::text
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select user_id, user_name, user_email, user_name, user_role::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase4_permission_smoke_ids s
cross join lateral (
  values
    (s.admin_id, 'Phase 4 Admin', s.admin_email, 'ADMIN'),
    (s.wms_creator_id, 'Phase 4 WMS Creator', s.wms_creator_email, 'EMPLOYEE'),
    (s.wms_approver_id, 'Phase 4 WMS Approver', s.wms_approver_email, 'EMPLOYEE'),
    (s.no_grant_id, 'Phase 4 No Grant', s.no_grant_email, 'EMPLOYEE'),
    (s.expense_owner_id, 'Phase 4 Expense Owner', s.expense_owner_email, 'EMPLOYEE'),
    (s.expense_other_id, 'Phase 4 Expense Other', s.expense_other_email, 'EMPLOYEE'),
    (s.expense_creator_id, 'Phase 4 Expense Creator', s.expense_creator_email, 'EMPLOYEE')
) as u(user_id, user_name, user_email, user_role);

insert into public.warehouses (id, name, address, type)
select warehouse_a_id, 'Phase 4 Warehouse A', 'Smoke address A', 'SITE'::public.warehouse_type
from phase4_permission_smoke_ids
union all
select warehouse_b_id, 'Phase 4 Warehouse B', 'Smoke address B', 'SITE'::public.warehouse_type
from phase4_permission_smoke_ids;

insert into public.budget_categories (id, name, code, year, "order", source)
select category_id, 'Phase 4 Expense Category', 'PHASE4-EXP', 2026, 0, 'smoke'
from phase4_permission_smoke_ids;

insert into public.expense_records (id, "categoryId", amount, date, description, "createdBy")
select owner_expense_id, category_id, 100, current_date, 'owner row', 'Phase 4 Expense Owner'
from phase4_permission_smoke_ids
union all
select other_expense_id, category_id, 200, current_date, 'other row', 'Phase 4 Expense Other'
from phase4_permission_smoke_ids;

insert into public.transactions (
  id,
  type,
  date,
  items,
  target_warehouse_id,
  requester_id,
  approver_id,
  status,
  pending_items
)
select process_tx_id, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb, warehouse_a_id, wms_creator_id, wms_approver_id, 'PENDING'::public.transaction_status, '[]'::jsonb
from phase4_permission_smoke_ids;

set role authenticated;

create or replace function pg_temp.phase4_permission_smoke_set_user(p_email text, p_sub uuid default gen_random_uuid())
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.email', p_email, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('email', p_email, 'sub', p_sub::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

select pg_temp.phase4_permission_smoke_set_user((select admin_email from phase4_permission_smoke_ids));

select public.replace_user_permission_grants(
  (select wms_creator_id from phase4_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'wms.transaction.create',
    'scope_type', 'warehouse',
    'scope_id', (select warehouse_a_id from phase4_permission_smoke_ids),
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select wms_approver_id from phase4_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'wms.transaction.approve',
    'scope_type', 'warehouse',
    'scope_id', (select warehouse_a_id from phase4_permission_smoke_ids),
    'is_active', true
  ))
);

select public.replace_user_permission_grants(
  (select expense_owner_id from phase4_permission_smoke_ids),
  jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'expense.expense_record.view_own',
      'scope_type', 'own',
      'scope_id', (select expense_owner_id::text from phase4_permission_smoke_ids),
      'is_active', true
    ),
    jsonb_build_object(
      'permission_code', 'expense.expense_record.edit_own',
      'scope_type', 'own',
      'scope_id', (select expense_owner_id::text from phase4_permission_smoke_ids),
      'is_active', true
    ),
    jsonb_build_object(
      'permission_code', 'expense.expense_record.create',
      'scope_type', 'global',
      'scope_id', '*',
      'is_active', true
    )
  )
);

select public.replace_user_permission_grants(
  (select expense_creator_id from phase4_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'expense.expense_record.create',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

do $$
begin
  begin
    perform public.replace_user_permission_grants(
      (select no_grant_id from phase4_permission_smoke_ids),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'analytics.export',
        'scope_type', 'warehouse',
        'scope_id', (select warehouse_a_id from phase4_permission_smoke_ids),
        'is_active', true
      ))
    );
    raise exception 'Invalid analytics.export warehouse grant unexpectedly succeeded';
  exception
    when check_violation then
      null;
  end;
end $$;

select pg_temp.phase4_permission_smoke_set_user((select wms_creator_email from phase4_permission_smoke_ids));

do $$
declare
  s phase4_permission_smoke_ids%rowtype;
begin
  select * into s from phase4_permission_smoke_ids;

  if not public.has_permission('wms.transaction.create', 'warehouse', s.warehouse_a_id) then
    raise exception 'public.has_permission did not honor warehouse grant';
  end if;

  if public.has_permission('wms.transaction.create', 'warehouse', s.warehouse_b_id) then
    raise exception 'warehouse-scoped grant incorrectly allowed wrong warehouse';
  end if;

  if not public.has_any_permission(array['wms.transaction.complete', 'wms.transaction.create'], 'warehouse', s.warehouse_a_id) then
    raise exception 'public.has_any_permission did not honor warehouse grant';
  end if;

  perform public.assert_permission('wms.transaction.create', 'warehouse', s.warehouse_a_id);

  begin
    perform public.assert_permission('wms.transaction.complete', 'warehouse', s.warehouse_a_id);
    raise exception 'assert_permission unexpectedly allowed missing complete grant';
  exception
    when insufficient_privilege then
      null;
  end;

  insert into public.transactions (
    id,
    type,
    date,
    items,
    source_warehouse_id,
    requester_id,
    status,
    pending_items
  )
  values (
    'phase4-wms-create-ok-' || gen_random_uuid()::text,
    'EXPORT'::public.transaction_type,
    now(),
    '[]'::jsonb,
    s.warehouse_a_id,
    s.wms_creator_id,
    'PENDING'::public.transaction_status,
    '[]'::jsonb
  );

  begin
    insert into public.transactions (
      id,
      type,
      date,
      items,
      source_warehouse_id,
      requester_id,
      status,
      pending_items
    )
    values (
      'phase4-wms-create-bad-' || gen_random_uuid()::text,
      'EXPORT'::public.transaction_type,
      now(),
      '[]'::jsonb,
      s.warehouse_b_id,
      s.wms_creator_id,
      'PENDING'::public.transaction_status,
      '[]'::jsonb
    );
    raise exception 'warehouse-scoped transaction insert unexpectedly allowed wrong warehouse';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

select pg_temp.phase4_permission_smoke_set_user((select no_grant_email from phase4_permission_smoke_ids));

do $$
begin
  begin
    insert into public.warehouses (id, name, address, type)
    values ('phase4-wh-deny-' || gen_random_uuid()::text, 'Phase 4 Deny Warehouse', 'Smoke deny', 'SITE'::public.warehouse_type);
    raise exception 'no-grant warehouse insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.transactions (
      id,
      type,
      date,
      items,
      target_warehouse_id,
      requester_id,
      status,
      pending_items
    )
    select 'phase4-nogrant-tx-' || gen_random_uuid()::text, 'IMPORT'::public.transaction_type, now(), '[]'::jsonb, warehouse_a_id, no_grant_id, 'PENDING'::public.transaction_status, '[]'::jsonb
    from phase4_permission_smoke_ids;
    raise exception 'no-grant transaction insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.expense_records (id, "categoryId", amount, date, description, "createdBy")
    select gen_random_uuid(), category_id, 300, current_date, 'no grant row', 'Phase 4 No Grant'
    from phase4_permission_smoke_ids;
    raise exception 'no-grant expense insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

select pg_temp.phase4_permission_smoke_set_user((select wms_approver_email from phase4_permission_smoke_ids));

do $$
declare
  s phase4_permission_smoke_ids%rowtype;
begin
  select * into s from phase4_permission_smoke_ids;

  if not app_private.wms_has_action('wms.transaction.approve', null, s.warehouse_a_id) then
    raise exception 'wms.transaction.approve grant not honored';
  end if;

  if app_private.wms_has_action('wms.transaction.complete', null, s.warehouse_a_id) then
    raise exception 'wms.transaction.approve incorrectly implied complete';
  end if;

  perform public.process_transaction_status(s.process_tx_id, 'APPROVED'::public.transaction_status, s.wms_approver_id);

  begin
    perform public.process_transaction_status(s.process_tx_id, 'COMPLETED'::public.transaction_status, s.wms_approver_id);
    raise exception 'approve-only user unexpectedly completed transaction';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

select pg_temp.phase4_permission_smoke_set_user((select expense_owner_email from phase4_permission_smoke_ids));

do $$
declare
  s phase4_permission_smoke_ids%rowtype;
  visible_rows integer;
begin
  select * into s from phase4_permission_smoke_ids;

  select count(*) into visible_rows
  from public.expense_records
  where id in (s.owner_expense_id, s.other_expense_id);

  if visible_rows <> 1 then
    raise exception 'expense view_own expected exactly one row, got %', visible_rows;
  end if;

  update public.expense_records
  set amount = amount + 1
  where id = s.owner_expense_id;

  if not found then
    raise exception 'expense edit_own did not update owner row';
  end if;

  begin
    update public.expense_records
    set amount = amount + 1
    where id = s.other_expense_id;
    if found then
      raise exception 'expense edit_own unexpectedly updated another owner row';
    end if;
  exception
    when insufficient_privilege then
      null;
  end;

  insert into public.expense_records (id, "categoryId", amount, date, description, "createdBy")
  values (gen_random_uuid(), s.category_id, 125, current_date, 'self-created row', 'Phase 4 Expense Owner');

  begin
    insert into public.expense_records (id, "categoryId", amount, date, description, "createdBy")
    values (gen_random_uuid(), s.category_id, 125, current_date, 'spoof-created row', 'Phase 4 Expense Other');
    raise exception 'expense create unexpectedly allowed spoofed createdBy';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

select pg_temp.phase4_permission_smoke_set_user((select expense_creator_email from phase4_permission_smoke_ids));

do $$
begin
  begin
    update public.expense_records
    set amount = amount + 10
    where id = (select owner_expense_id from phase4_permission_smoke_ids);
    if found then
      raise exception 'expense create-only user unexpectedly updated a record';
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

rollback;
