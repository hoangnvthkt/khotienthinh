-- Run after authorization_v2_phase4_remaining_enforced_rooms.
-- The Cloud transaction runner wraps this file in a savepoint and rolls it back.

do $$
begin
  if (select count(*) from public.project_permission_rooms where is_active) <> 10 then
    raise exception 'Expected exactly 10 active Project Rooms';
  end if;

  if exists (
    select 1 from app_private.project_permission_room_action_bindings
    where enforcement_status = 'audit_only' or pbac_fallback_enabled
  ) then
    raise exception 'An audit-only or fallback-enabled Room binding remains';
  end if;

  if app_private.permission_hardening_flag('project_room_pbac_fallback_enabled') then
    raise exception 'Global Project Room PBAC fallback remains enabled';
  end if;

  if exists (
    select 1
    from public.project_permission_rooms room
    cross join lateral unnest(room.allowed_actions) allowed(action_code)
    left join app_private.project_permission_room_action_bindings binding
      on binding.room_code = room.code and binding.action_code = allowed.action_code
    where room.is_active
      and (binding.room_code is null or binding.enforcement_status <> 'enforced')
  ) then
    raise exception 'An active Room action is not enforced';
  end if;

  if exists (
    select 1
    from public.project_permission_room_members member
    join public.project_staff staff on staff.id = member.project_staff_id
    where member.is_active and staff.end_date is not null
  ) then
    raise exception 'A stale active Room member remains';
  end if;

  if (select count(*) from app_private.authorization_room_retirement_dispositions) <> 4 then
    raise exception 'Four retired Room dispositions are required';
  end if;

  if not exists (
    select 1 from app_private.authorization_room_action_dispositions
    where room_code = 'material_request' and action_code = 'verify'
      and disposition = 'retired_no_business_path'
  ) then
    raise exception 'material_request.verify retirement evidence is missing';
  end if;

  if exists (
    select 1 from public.project_permission_rooms
    where code = 'material_request' and 'verify' = any(allowed_actions)
  ) or exists (
    select 1 from public.permission_actions
    where permission_code = 'project.material_request.verify' and is_active
  ) then
    raise exception 'material_request.verify is still active';
  end if;
end $$;

do $$
declare
  v_staff public.project_staff%rowtype;
  v_user public.users%rowtype;
  v_member_id uuid;
  v_wrong_project text := 'authorization-v2-wrong-project';
begin
  select staff.* into v_staff
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
  where staff.end_date is null
    and staff.project_id is not null
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and user_row.role <> 'ADMIN'
    and user_row.auth_id is not null
  order by staff.created_at nulls last, staff.id
  limit 1;

  if v_staff.id is null then
    raise exception 'No active non-admin Project staff fixture is available';
  end if;
  select * into v_user from public.users where id::text = v_staff.user_id;

  insert into public.project_permission_room_members (
    project_id, construction_site_id, room_code, project_staff_id,
    is_active, created_by, created_at, updated_at
  ) values (
    v_staff.project_id, v_staff.construction_site_id, 'safety', v_staff.id,
    true, null, now(), now()
  )
  on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
  do update set is_active = true, updated_at = now()
  returning id into v_member_id;

  insert into public.project_permission_room_member_actions (
    room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
  ) values (v_member_id, 'view', true, null, now(), now(), 'manual_room')
  on conflict (room_member_id, action_code) do update set is_active = true, updated_at = now();

  update public.project_permission_room_member_actions
  set is_active = false, updated_at = now()
  where room_member_id = v_member_id
    and action_code <> 'view'
    and is_active;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user.auth_id, 'email', v_user.email, 'role', 'authenticated'
  )::text, true);
  perform set_config('role', 'authenticated', true);

  if not app_private.safety_can_manage(
    v_staff.project_id, v_staff.construction_site_id, v_user.id::text
  ) then
    raise exception 'Assigned Safety actor with Room view was denied';
  end if;

  if app_private.safety_can_manage(
    v_staff.project_id, v_staff.construction_site_id, gen_random_uuid()::text
  ) then
    raise exception 'Unassigned Safety actor with view-only Room access was allowed to mutate';
  end if;

  perform set_config('role', 'postgres', true);

  if app_private.project_actor_has_effective_room_action(
    v_user.id, v_wrong_project, v_staff.construction_site_id, 'safety', 'view'
  ) then
    raise exception 'Safety Room action leaked to a different project';
  end if;

  if v_staff.construction_site_id is not null and app_private.project_actor_has_effective_room_action(
    v_user.id, v_staff.project_id, gen_random_uuid()::text, 'safety', 'view'
  ) then
    raise exception 'Safety Room action leaked to a different construction site';
  end if;
end $$;

do $$
declare
  v_admin public.users%rowtype;
  v_staff public.project_staff%rowtype;
  v_acceptance public.quantity_acceptances%rowtype;
  v_paid public.payment_certificates%rowtype;
  v_failed boolean := false;
begin
  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;
  if v_admin.id is null then
    raise exception 'No active System Admin fixture is available';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin.auth_id, 'email', v_admin.email, 'role', 'authenticated'
  )::text, true);
  perform set_config('role', 'authenticated', true);

  select * into v_staff from public.project_staff
  where end_date is null and project_id is not null
  order by created_at nulls last, id limit 1;
  begin
    perform public.replace_project_permission_room_members(
      v_staff.project_id, v_staff.construction_site_id, 'safety',
      jsonb_build_array(jsonb_build_object(
        'project_staff_id', v_staff.id,
        'action_codes', jsonb_build_array('not_an_action')
      ))
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Room assignment accepted an unknown action';
  end if;

  select * into v_acceptance from public.quantity_acceptances
  where status = 'submitted'
    and exists (select 1 from public.quantity_acceptance_items item where item.acceptance_id = quantity_acceptances.id)
  order by created_at limit 1;
  if v_acceptance.id is not null then
    v_acceptance := public.transition_project_quantity_acceptance_status(
      v_acceptance.id, 'approved', v_admin.id
    );
    if v_acceptance.status <> 'approved' then
      raise exception 'Quantity Acceptance approval did not reach approved state';
    end if;
  end if;

  select * into v_paid from public.payment_certificates
  where status = 'paid' order by created_at limit 1;
  if v_paid.id is not null then
    v_failed := false;
    begin
      perform public.transition_project_payment_certificate_status(
        v_paid.id, 'approved', v_admin.id
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Paid Payment Certificate accepted an invalid final-state transition';
    end if;
  end if;

  perform set_config('role', 'postgres', true);
  perform app_private.assert_project_permission_room_action(
    coalesce(v_staff.project_id, 'authorization-v2-admin-project'),
    v_staff.construction_site_id,
    'payment', 'confirm', v_admin.id
  );
end $$;

select jsonb_build_object(
  'result', 'authorization_v2_room_remaining_enforced_smoke_passed',
  'activeRooms', (select count(*) from public.project_permission_rooms where is_active),
  'auditOnlyBindings', (select count(*) from app_private.project_permission_room_action_bindings where enforcement_status = 'audit_only'),
  'fallbackBindings', (select count(*) from app_private.project_permission_room_action_bindings where pbac_fallback_enabled),
  'staleMembers', (
    select count(*)
    from public.project_permission_room_members member
    join public.project_staff staff on staff.id = member.project_staff_id
    where member.is_active and staff.end_date is not null
  ),
  'finalRoomMemberships', (
    select jsonb_object_agg(room_code, member_count)
    from (
      select room_code, count(*) member_count
      from public.project_permission_room_members
      where is_active and room_code in ('quantity_acceptance', 'payment', 'safety')
      group by room_code order by room_code
    ) counts
  ),
  'retiredRooms', (select count(*) from app_private.authorization_room_retirement_dispositions),
  'retiredActions', (select count(*) from app_private.authorization_room_action_dispositions),
  'roomFallbackEnabled', app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
) as result;
