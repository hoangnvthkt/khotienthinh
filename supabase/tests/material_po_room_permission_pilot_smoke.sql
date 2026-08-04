-- Run after local reset:
-- npx supabase db query --local -f supabase/tests/material_po_room_permission_pilot_smoke.sql

begin;

do $$
declare
  v_expected_actions integer;
begin
  select sum(cardinality(room.allowed_actions))::integer
  into v_expected_actions
  from public.project_permission_rooms room
  where room.is_active;

  if (select count(*) from app_private.project_permission_room_action_bindings) <> v_expected_actions then
    raise exception 'Binding registry is not one-to-one with active Room actions';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings where enforcement_status = 'pilot') <> 15 then
    raise exception 'Expected exactly 15 pilot actions after Material PO cutover';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings where room_code = 'material_po' and enforcement_status = 'pilot') <> 6 then
    raise exception 'All six Material PO actions must be pilot';
  end if;
  if exists (
    select 1
    from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'material_po'
      and 'project.material_po.manage' = any(binding.legacy_permission_codes)
  ) then
    raise exception 'project.material_po.manage must remain unmapped';
  end if;
  if not exists (
    select 1 from app_private.project_permission_room_action_bindings
    where room_code = 'material_po' and action_code = 'edit'
      and legacy_permission_codes = array['project.material_po.create']::text[]
  ) or not exists (
    select 1 from app_private.project_permission_room_action_bindings
    where room_code = 'material_po' and action_code = 'submit'
      and legacy_permission_codes = array['project.material_po.create']::text[]
  ) then
    raise exception 'Legacy PO create must safely backfill edit and submit only';
  end if;
  if to_regprocedure('app_private.guard_project_purchase_order_room_write()') is null
    or to_regprocedure('app_private.guard_purchase_order_supplemental_assignment()') is null then
    raise exception 'PO database guard surface is incomplete';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'purchase_orders'
      and policyname in ('purchase_orders_select','purchase_orders_insert','purchase_orders_update','purchase_orders_delete')) <> 4 then
    raise exception 'Purchase Order RLS policy set is incomplete';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'purchase_orders'
      and policyname = 'purchase_orders_archive_update'
  ) then
    raise exception 'Legacy direct archive policy is still active';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.create_delivery_batch_with_wms_qr_v2(text,uuid,text,text,text,numeric,text,date,text,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated can still execute the private delivery command';
  end if;
  if pg_get_functiondef('public.transition_project_purchase_order_status(text,text,jsonb)'::regprocedure)
      not like '%Quyền Xác nhận PO không thay thế quyền ghi nhận tồn kho WMS%' then
    raise exception 'PO confirm-to-WMS boundary is missing';
  end if;
end $$;

create temp table material_po_pilot_smoke_ids (
  project_id text not null,
  position_id uuid not null,
  admin_id uuid not null,
  edit_owner_id uuid not null,
  delete_owner_id uuid not null,
  submit_owner_id uuid not null,
  approver_id uuid not null,
  wrong_approver_id uuid not null,
  confirm_id uuid not null,
  fallback_id uuid not null,
  manage_id uuid not null,
  expired_id uuid not null
) on commit drop;

insert into material_po_pilot_smoke_ids values (
  'material-po-pilot-smoke-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

grant select on material_po_pilot_smoke_ids to authenticated;

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select admin_id, 'PO Pilot Admin', admin_id::text || '@vioo.local', admin_id::text, 'ADMIN'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select edit_owner_id, 'PO Edit Owner', edit_owner_id::text || '@vioo.local', edit_owner_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select delete_owner_id, 'PO Delete Owner', delete_owner_id::text || '@vioo.local', delete_owner_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select submit_owner_id, 'PO Submit Owner', submit_owner_id::text || '@vioo.local', submit_owner_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select approver_id, 'PO Approver', approver_id::text || '@vioo.local', approver_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select wrong_approver_id, 'PO Wrong Approver', wrong_approver_id::text || '@vioo.local', wrong_approver_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select confirm_id, 'PO Logistics', confirm_id::text || '@vioo.local', confirm_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select fallback_id, 'PO Fallback', fallback_id::text || '@vioo.local', fallback_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select manage_id, 'PO Manage Exception', manage_id::text || '@vioo.local', manage_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids
union all select expired_id, 'PO Expired Staff', expired_id::text || '@vioo.local', expired_id::text, 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from material_po_pilot_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PO-PILOT-' || substr(project_id, -8), 'Material PO Pilot Smoke', 'manual'
from material_po_pilot_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'PO Pilot Position', 1, 'PO-PILOT-' || substr(project_id, -8), true, 0, 'smoke', '{}'::jsonb
from material_po_pilot_smoke_ids;

insert into public.project_staff (
  id, project_id, user_id, position_id, start_date, end_date, note
)
select gen_random_uuid(), project_id, edit_owner_id::text, position_id, current_date, null::date, 'edit owner' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, delete_owner_id::text, position_id, current_date, null::date, 'delete owner' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, submit_owner_id::text, position_id, current_date, null::date, 'submit owner' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, approver_id::text, position_id, current_date, null::date, 'approver' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, wrong_approver_id::text, position_id, current_date, null::date, 'wrong approver' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, confirm_id::text, position_id, current_date, null::date, 'confirm' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, fallback_id::text, position_id, current_date, null::date, 'fallback' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, manage_id::text, position_id, current_date, null::date, 'manage exception' from material_po_pilot_smoke_ids
union all select gen_random_uuid(), project_id, expired_id::text, position_id, current_date - 2, current_date - 1, 'expired' from material_po_pilot_smoke_ids;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select ids.project_id, null, 'material_po', staff.id, true
from material_po_pilot_smoke_ids ids
join public.project_staff staff on staff.project_id = ids.project_id
where staff.user_id in (
  ids.edit_owner_id::text, ids.delete_owner_id::text, ids.submit_owner_id::text,
  ids.approver_id::text, ids.wrong_approver_id::text, ids.confirm_id::text,
  ids.expired_id::text
);

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active
)
select member.id,
  case staff.user_id
    when ids.edit_owner_id::text then 'edit'
    when ids.delete_owner_id::text then 'delete'
    when ids.submit_owner_id::text then 'submit'
    when ids.approver_id::text then 'approve'
    when ids.wrong_approver_id::text then 'approve'
    when ids.confirm_id::text then 'confirm'
    when ids.expired_id::text then 'edit'
  end,
  true
from material_po_pilot_smoke_ids ids
join public.project_staff staff on staff.project_id = ids.project_id
join public.project_permission_room_members member on member.project_staff_id = staff.id
where member.room_code = 'material_po';

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select fallback_id, 'project.material_po.create', 'project', project_id, true
from material_po_pilot_smoke_ids
union all
select manage_id, 'project.material_po.manage', 'project', project_id, true
from material_po_pilot_smoke_ids;

insert into app_private.purchase_order_number_registry(po_number)
values
  ('PO-20999901'), ('PO-20999902'), ('PO-20999903'), ('PO-20999904'),
  ('PO-20999905'), ('PO-20999906'), ('PO-20999907')
on conflict (po_number) do nothing;

insert into public.purchase_orders (
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number,
  items, total_amount, order_date, status, source_mode, created_by_id,
  submitted_to_user_id, created_at
)
select 'po-edit-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999901',
  '[]'::jsonb, 0, current_date::text, 'draft', 'proactive_project', edit_owner_id::text, null, now()
from material_po_pilot_smoke_ids
union all select 'po-delete-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999902',
  '[]'::jsonb, 0, current_date::text, 'draft', 'proactive_project', delete_owner_id::text, null, now()
from material_po_pilot_smoke_ids
union all select 'po-submit-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999903',
  '[]'::jsonb, 0, current_date::text, 'draft', 'proactive_project', submit_owner_id::text, null, now()
from material_po_pilot_smoke_ids
union all select 'po-approve-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999904',
  '[]'::jsonb, 0, current_date::text, 'sent', 'proactive_project', submit_owner_id::text, approver_id::text, now()
from material_po_pilot_smoke_ids
union all select 'po-return-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999905',
  '[]'::jsonb, 0, current_date::text, 'sent', 'proactive_project', submit_owner_id::text, approver_id::text, now()
from material_po_pilot_smoke_ids
union all select 'po-confirm-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999906',
  '[]'::jsonb, 0, current_date::text, 'confirmed', 'proactive_project', submit_owner_id::text, null, now()
from material_po_pilot_smoke_ids
union all select 'po-manage-' || project_id, project_id, null, 'vendor', 'NCC', 'PO-20999907',
  '[]'::jsonb, 0, current_date::text, 'draft', 'proactive_project', manage_id::text, null, now()
from material_po_pilot_smoke_ids;

do $$
declare ids material_po_pilot_smoke_ids%rowtype;
begin
  select * into ids from material_po_pilot_smoke_ids;
  if not app_private.project_actor_has_effective_room_action(ids.edit_owner_id, ids.project_id, null, 'material_po', 'edit')
    or app_private.project_actor_has_effective_room_action(ids.edit_owner_id, ids.project_id, null, 'material_po', 'submit') then
    raise exception 'Room edit leaked into submit';
  end if;
  if not app_private.project_actor_has_effective_room_action(ids.fallback_id, ids.project_id, null, 'material_po', 'edit')
    or not app_private.project_actor_has_effective_room_action(ids.fallback_id, ids.project_id, null, 'material_po', 'submit') then
    raise exception 'Exact PBAC create fallback did not map to edit + submit';
  end if;
  if app_private.project_actor_has_effective_room_action(ids.manage_id, ids.project_id, null, 'material_po', 'view')
    or app_private.project_actor_has_effective_room_action(ids.manage_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'PBAC manage implied a Room action';
  end if;
  if app_private.project_actor_has_effective_room_action(ids.expired_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'Expired staff retained Room edit';
  end if;
  if app_private.project_actor_has_effective_room_action(ids.edit_owner_id, 'wrong-project', null, 'material_po', 'edit') then
    raise exception 'Room edit leaked across project scope';
  end if;
  if public.project_user_has_room_action(ids.project_id, null, 'material_po', 'approve', ids.admin_id) then
    raise exception 'System Admin became an implicit recipient';
  end if;
  if not app_private.project_actor_has_effective_room_action(ids.admin_id, ids.project_id, null, 'material_po', 'approve') then
    raise exception 'System Admin actor override is missing';
  end if;
end $$;

set local role authenticated;

create or replace function pg_temp.material_po_pilot_set_user(p_user_id uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.email', p_user_id::text || '@vioo.local', true);
  select set_config('request.jwt.claim.sub', p_user_id::text, true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'email', p_user_id::text || '@vioo.local', 'sub', p_user_id::text
  )::text, true);
$$;

select pg_temp.material_po_pilot_set_user(edit_owner_id) from material_po_pilot_smoke_ids;

do $$
declare ids material_po_pilot_smoke_ids%rowtype; v_updated integer;
begin
  select * into ids from material_po_pilot_smoke_ids;
  update public.purchase_orders set note = 'edited by owner'
  where id = 'po-edit-' || ids.project_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'Room edit owner could not update draft PO'; end if;

  begin
    perform public.transition_project_purchase_order_status(
      'po-edit-' || ids.project_id, 'sent', jsonb_build_object(
        'submitted_to_user_id', ids.approver_id::text
      )
    );
    raise exception 'Room edit incorrectly implied submit';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.remove_purchase_order_v1('po-edit-' || ids.project_id);
    raise exception 'Creator without Room delete removed PO';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.material_po_pilot_set_user(delete_owner_id) from material_po_pilot_smoke_ids;
do $$
declare ids material_po_pilot_smoke_ids%rowtype; v_action text;
begin
  select * into ids from material_po_pilot_smoke_ids;
  select result.action into v_action
  from public.remove_purchase_order_v1('po-delete-' || ids.project_id) result;
  if v_action <> 'deleted' then raise exception 'Room delete owner could not remove draft PO'; end if;
end $$;

select pg_temp.material_po_pilot_set_user(submit_owner_id) from material_po_pilot_smoke_ids;
select public.transition_project_purchase_order_status(
  'po-submit-' || project_id,
  'sent',
  jsonb_build_object('submitted_to_user_id', approver_id::text, 'submitted_to_name', 'PO Approver')
) from material_po_pilot_smoke_ids;

select pg_temp.material_po_pilot_set_user(wrong_approver_id) from material_po_pilot_smoke_ids;
do $$
declare ids material_po_pilot_smoke_ids%rowtype;
begin
  select * into ids from material_po_pilot_smoke_ids;
  begin
    perform public.transition_project_purchase_order_status(
      'po-approve-' || ids.project_id, 'confirmed', '{}'::jsonb
    );
    raise exception 'Unassigned approver approved PO';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.material_po_pilot_set_user(approver_id) from material_po_pilot_smoke_ids;
select public.transition_project_purchase_order_status(
  'po-approve-' || project_id, 'confirmed', '{}'::jsonb
) from material_po_pilot_smoke_ids;
select public.transition_project_purchase_order_status(
  'po-return-' || project_id, 'returned', '{}'::jsonb
) from material_po_pilot_smoke_ids;

do $$
declare ids material_po_pilot_smoke_ids%rowtype;
begin
  select * into ids from material_po_pilot_smoke_ids;
  if exists (
    select 1 from public.purchase_orders
    where id = 'po-return-' || ids.project_id
      and (status <> 'returned' or submitted_to_user_id is not null)
  ) then
    raise exception 'Return did not clear the previous approval assignment';
  end if;
end $$;

select pg_temp.material_po_pilot_set_user(confirm_id) from material_po_pilot_smoke_ids;
select public.transition_project_purchase_order_status(
  'po-confirm-' || project_id, 'delivered', '{}'::jsonb
) from material_po_pilot_smoke_ids;

do $$
declare ids material_po_pilot_smoke_ids%rowtype;
begin
  select * into ids from material_po_pilot_smoke_ids;
  begin
    perform public.transition_project_purchase_order_status(
      'po-confirm-' || ids.project_id,
      'delivered',
      jsonb_build_object('received_transaction_ids', jsonb_build_array('forbidden-stock-write'))
    );
    raise exception 'Room confirm replaced WMS stock authority';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.material_po_pilot_set_user(manage_id) from material_po_pilot_smoke_ids;
do $$
declare ids material_po_pilot_smoke_ids%rowtype; v_seen integer;
begin
  select * into ids from material_po_pilot_smoke_ids;
  select count(*) into v_seen from public.purchase_orders where id = 'po-manage-' || ids.project_id;
  if v_seen <> 0 then raise exception 'PBAC manage implied PO view'; end if;
  if not exists (
    select 1 from public.get_my_project_room_pbac_exceptions(ids.project_id, null)
    where room_code = 'material_po' and permission_code = 'project.material_po.manage'
  ) then
    raise exception 'PBAC manage exception was not reported';
  end if;
end $$;

reset role;

do $$
declare ids material_po_pilot_smoke_ids%rowtype;
begin
  select * into ids from material_po_pilot_smoke_ids;
  update app_private.project_permission_room_action_bindings
  set enforcement_status = 'audit_only'
  where room_code = 'material_po' and action_code in ('edit', 'submit');

  if app_private.project_actor_has_effective_room_action(ids.edit_owner_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'audit_only rollback still accepted a Room grant';
  end if;
  if not app_private.project_actor_has_effective_room_action(ids.fallback_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'audit_only rollback lost exact PBAC fallback';
  end if;

  update app_private.project_permission_room_action_bindings
  set enforcement_status = 'pilot'
  where room_code = 'material_po' and action_code in ('edit', 'submit');

  update app_private.permission_hardening_settings
  set value = 'false'::jsonb
  where key = 'project_room_pbac_fallback_enabled';
  if app_private.project_actor_has_effective_room_action(ids.fallback_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'Disabled fallback still authorized PBAC-only user';
  end if;
  if not app_private.project_actor_has_effective_room_action(ids.edit_owner_id, ids.project_id, null, 'material_po', 'edit') then
    raise exception 'Disabled fallback also disabled Room authorization';
  end if;
  update app_private.permission_hardening_settings
  set value = 'true'::jsonb
  where key = 'project_room_pbac_fallback_enabled';
end $$;

rollback;
