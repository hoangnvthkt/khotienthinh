-- Run after local reset:
-- npx supabase db query --local -f supabase/tests/project_permission_rooms_smoke.sql

begin;

do $$
begin
  if (select count(*) from public.project_permission_rooms where is_active) <> 14 then
    raise exception 'Expected the fixed 14 permission Rooms';
  end if;

  if to_regprocedure('public.project_user_has_room_action(text,text,text,text,uuid)') is null
    or to_regprocedure('public.replace_project_permission_room_members(text,text,text,jsonb)') is null
    or to_regprocedure('public.list_project_room_action_recipients(text,text,text,text)') is null then
    raise exception 'Permission Room RPC surface is incomplete';
  end if;
end $$;

create temp table project_permission_rooms_smoke_ids (
  admin_id uuid not null,
  po_approver_id uuid not null,
  daily_approver_id uuid not null,
  project_id text not null,
  position_id uuid not null,
  po_staff_id uuid not null,
  daily_staff_id uuid not null,
  admin_email text not null,
  po_approver_email text not null,
  daily_approver_email text not null
) on commit drop;

insert into project_permission_rooms_smoke_ids
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'permission-room-smoke-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'permission-room-admin@vioo.local',
  'permission-room-po@vioo.local',
  'permission-room-daily@vioo.local'
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Permission Room Smoke Admin', admin_email, 'permission-room-admin', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_permission_rooms_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select po_approver_id, 'PO Approver', po_approver_email, 'permission-room-po', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_permission_rooms_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select daily_approver_id, 'Daily Log Approver', daily_approver_email, 'permission-room-daily', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from project_permission_rooms_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PERMISSION-ROOM-SMOKE', 'Permission Room Smoke', 'manual'
from project_permission_rooms_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Permission Room Smoke Position', 1, 'PERMISSION-ROOM-SMOKE', true, 0, 'smoke', '{}'::jsonb
from project_permission_rooms_smoke_ids;

insert into public.project_staff (id, project_id, user_id, position_id, start_date, note)
select po_staff_id, project_id, po_approver_id::text, position_id, current_date, 'PO approver'
from project_permission_rooms_smoke_ids;

insert into public.project_staff (id, project_id, user_id, position_id, start_date, note)
select daily_staff_id, project_id, daily_approver_id::text, position_id, current_date, 'Daily log approver'
from project_permission_rooms_smoke_ids;

set local role authenticated;
select set_config('request.jwt.claim.email', (select admin_email from project_permission_rooms_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select admin_email from project_permission_rooms_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

select public.replace_project_permission_room_members(
  (select project_id from project_permission_rooms_smoke_ids),
  null,
  'material_po',
  jsonb_build_array(jsonb_build_object(
    'project_staff_id', (select po_staff_id from project_permission_rooms_smoke_ids),
    'action_codes', jsonb_build_array('approve')
  ))
);

select public.replace_project_permission_room_members(
  (select project_id from project_permission_rooms_smoke_ids),
  null,
  'daily_log',
  jsonb_build_array(jsonb_build_object(
    'project_staff_id', (select daily_staff_id from project_permission_rooms_smoke_ids),
    'action_codes', jsonb_build_array('verify', 'approve')
  ))
);

do $$
declare
  v_project_id text := (select project_id from project_permission_rooms_smoke_ids);
  v_po_approver_id uuid := (select po_approver_id from project_permission_rooms_smoke_ids);
  v_daily_approver_id uuid := (select daily_approver_id from project_permission_rooms_smoke_ids);
begin
  if not public.project_user_has_room_action(v_project_id, null, 'material_po', 'approve', v_po_approver_id) then
    raise exception 'PO approver is missing material_po.approve';
  end if;
  if public.project_user_has_room_action(v_project_id, null, 'daily_log', 'approve', v_po_approver_id) then
    raise exception 'PO approver leaked into daily_log.approve';
  end if;
  if not public.project_user_has_room_action(v_project_id, null, 'daily_log', 'approve', v_daily_approver_id) then
    raise exception 'Daily log approver is missing daily_log.approve';
  end if;
  if public.project_user_has_room_action(v_project_id, null, 'material_po', 'approve', v_daily_approver_id) then
    raise exception 'Daily log approver leaked into material_po.approve';
  end if;
  if (select count(*) from public.list_project_room_action_recipients(v_project_id, null, 'material_po', 'approve')) <> 1 then
    raise exception 'PO recipient list must contain only the PO approver';
  end if;
  if (select count(*) from public.list_project_room_action_recipients(v_project_id, null, 'daily_log', 'approve')) <> 1 then
    raise exception 'Daily log recipient list must contain only the daily log approver';
  end if;
end $$;

do $$
declare
  v_project_id text := (select project_id from project_permission_rooms_smoke_ids);
  v_staff_id uuid := (select po_staff_id from project_permission_rooms_smoke_ids);
begin
  begin
    perform public.replace_project_permission_room_members(
      v_project_id,
      null,
      'material_po',
      jsonb_build_array(jsonb_build_object(
        'project_staff_id', v_staff_id,
        'action_codes', jsonb_build_array('view_available_stock')
      ))
    );
    raise exception 'Invalid Room action unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  if not public.project_user_has_room_action(
    v_project_id, null, 'material_po', 'approve',
    (select po_approver_id from project_permission_rooms_smoke_ids)
  ) then
    raise exception 'Invalid batch did not rollback the previous Room assignment';
  end if;
end $$;

reset role;
rollback;
