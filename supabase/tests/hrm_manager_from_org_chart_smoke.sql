-- Run after 20261017230000_hrm_manager_from_org_chart. Rolls back.
begin;
set local statement_timeout = '120s';

do $$
declare v_user uuid; v_other uuid;
begin
  -- Every seat someone sits on is an official seat; leftover head seats are gone.
  if exists (select 1 from public.hrm_org_position_slots slot where slot.status = 'ACTIVE' and slot.source <> 'workforce_plan'
      and exists (select 1 from public.hrm_employee_slot_assignments a where a.slot_id = slot.id and a.status = 'ACTIVE')) then
    raise exception 'MGR_OCCUPIED_SEAT_NOT_OFFICIAL';
  end if;
  if exists (select 1 from public.hrm_org_position_slots where source = 'roster_sync') then raise exception 'MGR_ROSTER_SYNC_LEFT'; end if;
  if exists (select 1 from public.org_units unit join public.hrm_org_position_slots slot on slot.id = unit.manager_slot_id
      where slot.status <> 'ACTIVE' or slot.source <> 'workforce_plan') then
    raise exception 'MGR_HEAD_SEAT_NOT_OFFICIAL';
  end if;
  -- Catalog follows the Data file.
  if exists (select 1 from public.hrm_positions where name in ('Cán bộ QS/QC', 'Trợ lý Phó TGĐ/Giám đốc chức năng')
      and source <> 'legacy' and level_code <> 'E5') then
    raise exception 'MGR_POSITION_LEVEL';
  end if;
  if (select group_code from public.hrm_position_levels where code = 'E4') <> 'CV' then raise exception 'MGR_E4_GROUP'; end if;

  -- The old per-account manager cannot be set or changed.
  select id into v_user from public.users where manager_id is null and coalesce(is_active, true) order by name limit 1;
  select id into v_other from public.users where id <> v_user and coalesce(is_active, true) order by name limit 1;
  begin
    update public.users set manager_id = v_other where id = v_user;
    raise exception 'MGR_MANAGER_SET_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'USER_MANAGER_FROM_ORG_CHART' then raise; end if;
  end;

  -- A person moved to a unit / position without a free seat gets a new official seat.
  perform set_config('test.m.emp', (select e.id::text from public.employees e
    join public.hrm_employee_slot_assignments a on a.employee_id = e.id and a.status = 'ACTIVE' and a.assignment_type = 'PRIMARY'
    where e.status = 'Đang làm việc' and not exists (select 1 from public.org_units u where u.manager_slot_id = a.slot_id)
    order by e.employee_code limit 1), true);
  update public.employees set org_unit_id = (select id from public.org_units where code = 'QLDA'),
    position_id = (select p.id from public.hrm_positions p where p.is_active and p.source <> 'legacy'
      and not exists (select 1 from public.hrm_org_position_slots s where s.position_id = p.id
        and s.org_unit_id = (select id from public.org_units where code = 'QLDA')) order by p.code limit 1)
  where id = current_setting('test.m.emp')::uuid;
  if (select source from public.hrm_org_position_slots where id = app_private.hrm_roster_sync_seat(current_setting('test.m.emp')::uuid,
      current_date, 'smoke')) <> 'workforce_plan' then
    raise exception 'MGR_NEW_SEAT_NOT_OFFICIAL';
  end if;
end;
$$;

-- Read side: every signed-in user sees the managers list; units without a head is HR only.
select set_config('test.m.hr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.name limit 1;
select set_config('test.m.plain_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.name limit 1;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.m.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_units jsonb; v_managers jsonb;
begin
  v_units := public.list_hrm_units_without_head();
  if jsonb_array_length(v_units) = 0 or not exists (select 1 from jsonb_array_elements(v_units) u where not (u ->> 'hasHead')::boolean) then
    raise exception 'MGR_UNITS_EMPTY %', v_units;
  end if;
  v_managers := public.list_user_direct_managers();
  if not exists (select 1 from jsonb_array_elements(v_managers) m where m ->> 'source' = 'org_chart') then raise exception 'MGR_LIST_NO_CHART'; end if;
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.m.plain_auth'))::text, true);
set local role authenticated;
do $$
begin
  if jsonb_array_length(public.list_user_direct_managers()) = 0 then raise exception 'MGR_LIST_PLAIN_EMPTY'; end if;
  begin
    perform public.list_hrm_units_without_head();
    raise exception 'MGR_UNITS_PLAIN_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select 'hrm_manager_from_org_chart_smoke ok' as result;
rollback;
