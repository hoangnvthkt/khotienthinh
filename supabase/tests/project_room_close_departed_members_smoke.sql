-- Smoke for 20261009180000_project_room_close_departed_members. Rolls back.
begin;

do $$
begin
  if exists (
    select 1 from public.project_permission_room_members member
    join public.project_staff staff on staff.id = member.project_staff_id
    left join public.users user_row on user_row.id::text = staff.user_id
    where member.is_active
      and (staff.end_date is not null or not coalesce(user_row.is_active, true)
        or staff.project_id is distinct from member.project_id)
  ) then
    raise exception 'departed staff still hold active Room memberships';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_project_staff_close_room_memberships') then
    raise exception 'close-on-end trigger missing';
  end if;
end $$;

-- Fixture: a project with two active staff in the same Room (A leaves, B gets a template).
create temporary table t_room (project_id text, room_code text, staff_a uuid, staff_b uuid, admin_auth uuid, admin_email text) on commit drop;
insert into t_room (project_id, room_code, staff_a, staff_b)
select a.project_id, a.room_code, a.project_staff_id, b.project_staff_id
from public.project_permission_room_members a
join public.project_permission_room_members b
  on b.project_id = a.project_id and b.room_code = a.room_code
 and b.construction_site_id is not distinct from a.construction_site_id
 and b.project_staff_id <> a.project_staff_id and b.is_active
join public.project_staff sa on sa.id = a.project_staff_id and sa.end_date is null
join public.project_staff sb on sb.id = b.project_staff_id and sb.end_date is null
where a.is_active and a.construction_site_id is null
  and exists (select 1 from public.project_permission_room_member_actions aa where aa.room_member_id = a.id and aa.is_active)
  -- A is never the only holder of a Room's required action (removing A must not empty a workflow step).
  and not exists (
    select 1 from public.project_permission_room_members am
    join public.project_permission_room_member_actions aa2 on aa2.room_member_id = am.id and aa2.is_active
    join public.project_permission_rooms room on room.code = am.room_code and aa2.action_code = any(room.required_actions)
    where am.project_staff_id = a.project_staff_id and am.is_active
      and not exists (
        select 1 from public.project_permission_room_members om
        join public.project_permission_room_member_actions oa on oa.room_member_id = om.id and oa.is_active
        where om.project_id = am.project_id and om.construction_site_id is not distinct from am.construction_site_id
          and om.room_code = am.room_code and om.is_active and om.project_staff_id <> am.project_staff_id
          and oa.action_code = aa2.action_code))
  -- B lacks part of the template in this Room, so applying it really rewrites the Room.
  and exists (
    select 1 from public.project_room_templates tpl
    cross join lateral jsonb_array_elements_text(tpl.room_actions -> a.room_code) wanted(action_code)
    where tpl.code = 'site_storekeeper'
      and not exists (select 1 from public.project_permission_room_member_actions ba
        where ba.room_member_id = b.id and ba.is_active and ba.action_code = wanted.action_code))
order by a.created_at limit 1;
update t_room set (admin_auth, admin_email) = (
  select u.auth_id, u.email from public.users u
  where u.role = 'ADMIN' and u.is_active and u.auth_id is not null order by u.created_at limit 1);
grant select on t_room to authenticated;

-- Leaving a project closes every Room membership of that person and logs it.
do $$
declare v t_room%rowtype;
begin
  select * into v from t_room;
  if v.staff_a is null then raise exception 'fixture missing'; end if;
  update public.project_staff set end_date = current_date where id = v.staff_a;
  if exists (select 1 from public.project_permission_room_members where project_staff_id = v.staff_a and is_active) then
    raise exception 'ending project staff left Room memberships open';
  end if;
  if exists (select 1 from public.project_permission_room_member_actions action
      join public.project_permission_room_members member on member.id = action.room_member_id
      where member.project_staff_id = v.staff_a and action.is_active) then
    raise exception 'ending project staff left Room actions open';
  end if;
  if not exists (select 1 from public.permission_audit_events
      where event_type = 'project_room_member_departed' and metadata->>'project_staff_id' = v.staff_a::text) then
    raise exception 'departure not audited';
  end if;
  -- Recreate the 09/10 state: a departed member still active in the Room.
  update public.project_permission_room_members set is_active = true
  where project_staff_id = v.staff_a and project_id = v.project_id and room_code = v.room_code
    and construction_site_id is null;
  update public.project_permission_room_member_actions action set is_active = true
  from public.project_permission_room_members member
  where member.id = action.room_member_id and member.project_staff_id = v.staff_a
    and member.project_id = v.project_id and member.room_code = v.room_code
    and member.construction_site_id is null;
end $$;

-- Applying a template to someone else no longer fails because of the departed member.
set local role authenticated;
do $$
declare v t_room%rowtype; v_state text; v_msg text;
begin
  select * into v from t_room;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v.admin_auth, 'email', v.admin_email, 'role', 'authenticated')::text, true);
  begin
    perform public.apply_project_room_template(v.project_id, null, v.staff_b, 'site_storekeeper', 'merge', false, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    raise exception 'template apply failed (%): %', v_state, v_msg;
  end;
end $$;
reset role;

do $$
declare v t_room%rowtype;
begin
  select * into v from t_room;
  if exists (select 1 from public.project_permission_room_members
      where project_staff_id = v.staff_a and project_id = v.project_id and room_code = v.room_code
    and construction_site_id is null and is_active) then
    raise exception 'template apply kept the departed member in the Room';
  end if;
end $$;

rollback;
