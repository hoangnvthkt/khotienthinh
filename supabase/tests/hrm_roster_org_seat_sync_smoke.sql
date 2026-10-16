-- Run after 20261017160000_hrm_roster_org_seat_sync. Rolls back.
begin;
set local statement_timeout = '120s';

-- After the first pass: everyone working sits on one seat of their own unit and position.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.employees employee
  where employee.status = 'Đang làm việc' and employee.org_unit_id is not null and employee.position_id is not null
    and (select count(*) from public.hrm_employee_slot_assignments assignment
      join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
      where assignment.employee_id = employee.id and assignment.status = 'ACTIVE' and assignment.assignment_type = 'PRIMARY'
        and slot.status = 'ACTIVE' and slot.org_unit_id = employee.org_unit_id and slot.position_id = employee.position_id) <> 1;
  if v_bad > 0 then raise exception 'SEAT_NOT_SYNCED %', v_bad; end if;
  if exists (select 1 from public.hrm_org_position_slots slot where slot.source = 'employee_backfill' and slot.status = 'ACTIVE'
      and not exists (select 1 from public.hrm_employee_slot_assignments o where o.slot_id = slot.id and o.status = 'ACTIVE')
      and not exists (select 1 from public.org_units unit where unit.manager_slot_id = slot.id)) then
    raise exception 'SEAT_EMPTY_BACKFILL_LEFT';
  end if;
  if exists (select 1 from public.hrm_org_position_slots slot join public.hrm_org_position_slots target on target.id = slot.reports_to_slot_id
      where slot.status = 'ACTIVE' and target.status = 'ARCHIVED') then
    raise exception 'SEAT_REPORTS_TO_ARCHIVED';
  end if;
  if exists (select 1 from public.org_units unit where unit.manager_slot_id is not null
      and not exists (select 1 from public.hrm_org_position_slots slot where slot.id = unit.manager_slot_id and slot.status = 'ACTIVE')) then
    raise exception 'SEAT_MANAGER_ARCHIVED';
  end if;
  -- The four heads chosen by title sit on their unit's manager seat.
  if (select count(*) from public.org_units unit
      join public.hrm_employee_slot_assignments assignment on assignment.slot_id = unit.manager_slot_id and assignment.status = 'ACTIVE'
      join public.employees employee on employee.id = assignment.employee_id
      join public.hrm_positions position on position.id = employee.position_id
      where unit.code in ('TKĐT', 'TCKT', 'TTTH', 'XINHAI') and position.name ~ '^(Trưởng phòng|Chỉ huy trưởng)') <> 4 then
    raise exception 'SEAT_HEADS_NOT_SET';
  end if;
end;
$$;

-- An approved request moving one person: the seat follows, the old seat is free again.
update public.hrm_roster_settings set general_step1 = '{}', general_step2 = '{}', pay_step1 = '{}', pay_step2 = '{}';
select set_config('test.s.a_auth', u.auth_id::text, true), set_config('test.s.a_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE' order by u.name limit 1;
select set_config('test.s.b_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE'
  and u.id::text <> current_setting('test.s.a_id') order by u.name limit 1;
select set_config('test.s.e1', e.id::text, true), set_config('test.s.old_slot', a.slot_id::text, true)
from public.employees e
join public.hrm_employee_slot_assignments a on a.employee_id = e.id and a.status = 'ACTIVE' and a.assignment_type = 'PRIMARY'
left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or app_private.hrm_roster_access(u.id) is null)
  and not exists (select 1 from public.org_units unit where unit.manager_slot_id = a.slot_id)
order by e.employee_code limit 1;
select set_config('test.s.unit', (select id::text from public.org_units where code = 'QLDA'), true);
select set_config('test.s.position', (select p.id::text from public.hrm_positions p where p.is_active and p.source <> 'legacy'
  and not exists (select 1 from public.hrm_org_position_slots s where s.position_id = p.id and s.org_unit_id = current_setting('test.s.unit')::uuid)
  order by p.code limit 1), true);

do $$
begin
  if current_setting('test.s.a_auth', true) is null or current_setting('test.s.b_auth', true) is null or current_setting('test.s.e1', true) is null
    or current_setting('test.s.position', true) is null then
    raise exception 'SEAT_SMOKE_FIXTURE_MISSING';
  end if;
end;
$$;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.s.a_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform set_config('test.s.batch', (public.submit_hrm_roster_batch('grid', 'Chuyển phòng smoke', 'Smoke sơ đồ: chuyển bộ phận và chức danh',
    app_private.hrm_vn_today(), jsonb_build_array(
      jsonb_build_object('employeeId', current_setting('test.s.e1'), 'field', 'orgUnit', 'newValue', current_setting('test.s.unit')),
      jsonb_build_object('employeeId', current_setting('test.s.e1'), 'field', 'position', 'newValue', current_setting('test.s.position'))), null)) ->> 'id', true);
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.s.b_auth'))::text, true);
set local role authenticated;
do $$ begin perform public.decide_hrm_roster_batch(current_setting('test.s.batch')::uuid, true, null); end; $$;
reset role;

do $$
declare v_seat public.hrm_org_position_slots%rowtype;
begin
  select slot.* into v_seat from public.hrm_employee_slot_assignments a join public.hrm_org_position_slots slot on slot.id = a.slot_id
  where a.employee_id = current_setting('test.s.e1')::uuid and a.status = 'ACTIVE' and a.assignment_type = 'PRIMARY';
  if v_seat.org_unit_id::text <> current_setting('test.s.unit') or v_seat.position_id::text <> current_setting('test.s.position')
    or v_seat.source <> 'roster_sync' then
    raise exception 'SEAT_NOT_MOVED %', to_jsonb(v_seat);
  end if;
  if exists (select 1 from public.hrm_employee_slot_assignments where slot_id = current_setting('test.s.old_slot')::uuid and status = 'ACTIVE') then
    raise exception 'SEAT_OLD_STILL_TAKEN';
  end if;
  if (select count(*) from public.hrm_employee_slot_assignments where employee_id = current_setting('test.s.e1')::uuid
      and status = 'ENDED' and slot_id = current_setting('test.s.old_slot')::uuid) <> 1 then
    raise exception 'SEAT_OLD_NOT_ENDED';
  end if;
  -- Same unit and position again: nothing changes.
  if app_private.hrm_roster_sync_seat(current_setting('test.s.e1')::uuid, app_private.hrm_vn_today(), null) <> v_seat.id then
    raise exception 'SEAT_RESYNC_MOVED';
  end if;
end;
$$;

select 'hrm_roster_org_seat_sync_smoke ok' as result;
rollback;
