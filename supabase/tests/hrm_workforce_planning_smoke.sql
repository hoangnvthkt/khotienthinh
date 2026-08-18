begin;

set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_org_unit_id uuid;
  v_position_ids uuid[];
  v_position_one public.hrm_positions%rowtype;
  v_position_two public.hrm_positions%rowtype;
  v_employee_ids uuid[];
  v_employee_one public.employees%rowtype;
  v_employee_two public.employees%rowtype;
  v_manager_slot_id uuid;
  v_blocked boolean := false;
  v_count integer;
begin
  select * into v_admin
  from public.users
  where role = 'ADMIN'
    and coalesce(is_active, true)
    and coalesce(account_status, 'ACTIVE') = 'ACTIVE'
  order by created_at
  limit 1;
  if v_admin.id is null then
    raise exception 'HRM_WORKFORCE_SMOKE_ADMIN_NOT_FOUND';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    coalesce(v_admin.auth_id, gen_random_uuid())::text,
    true
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', current_setting('request.jwt.claim.sub', true),
      'email', v_admin.email
    )::text,
    true
  );
  if public.current_app_user_id() is distinct from v_admin.id then
    raise exception 'HRM_WORKFORCE_SMOKE_ACTOR_NOT_RESOLVED';
  end if;

  select unit.id into v_org_unit_id
  from public.org_units unit
  where unit.is_active
  order by case unit.type when 'department' then 0 else 1 end,
           unit.order_index,
           unit.id
  limit 1;
  if v_org_unit_id is null then
    raise exception 'HRM_WORKFORCE_SMOKE_ORG_UNIT_NOT_FOUND';
  end if;

  select array_agg(position.id order by position.sort_order, position.id)
  into v_position_ids
  from (
    select approved.id, approved.sort_order
    from public.hrm_positions approved
    where approved.is_active
      and approved.source <> 'legacy'
    order by approved.sort_order, approved.id
    limit 2
  ) position;
  if coalesce(cardinality(v_position_ids), 0) < 2 then
    raise exception 'HRM_WORKFORCE_SMOKE_NEEDS_TWO_APPROVED_POSITIONS';
  end if;
  select * into v_position_one from public.hrm_positions where id = v_position_ids[1];
  select * into v_position_two from public.hrm_positions where id = v_position_ids[2];

  select array_agg(candidate.id order by candidate.employee_code, candidate.id)
  into v_employee_ids
  from (
    select employee.id, employee.employee_code
    from public.employees employee
    join public.users account on account.id = employee.user_id
    where employee.status = 'Đang làm việc'
      and coalesce(account.is_active, true)
      and coalesce(account.account_status, 'ACTIVE') = 'ACTIVE'
      and not exists (
        select 1
        from public.hrm_employee_slot_assignments active_assignment
        where active_assignment.employee_id = employee.id
          and active_assignment.status = 'ACTIVE'
          and active_assignment.assignment_type = 'PRIMARY'
      )
    order by employee.employee_code, employee.id
    limit 2
  ) candidate;
  if coalesce(cardinality(v_employee_ids), 0) < 2 then
    raise exception 'HRM_WORKFORCE_SMOKE_NEEDS_TWO_UNASSIGNED_EMPLOYEES';
  end if;
  select * into v_employee_one from public.employees where id = v_employee_ids[1];
  select * into v_employee_two from public.employees where id = v_employee_ids[2];

  perform public.adjust_hrm_staffing(
    v_org_unit_id, v_position_one.id, v_position_one.level_code,
    null, 2, 'Smoke: tạo định biên hai người'
  );
  select count(*)::integer into v_count
  from public.hrm_org_position_slots slot
  where slot.org_unit_id = v_org_unit_id
    and slot.position_id = v_position_one.id
    and slot.level_code is not distinct from v_position_one.level_code
    and slot.reports_to_slot_id is null
    and slot.source = 'workforce_plan'
    and slot.status = 'ACTIVE';
  if v_count <> 2 then
    raise exception 'HRM_WORKFORCE_SMOKE_EXPECTED_TWO_SLOTS, found %', v_count;
  end if;

  perform public.assign_hrm_employee_to_staffing(
    v_employee_one.id, v_org_unit_id, v_position_one.id,
    v_position_one.level_code, null, current_date,
    'Smoke: phân bổ nhân sự'
  );
  if not exists (
    select 1
    from public.hrm_employee_slot_assignments assignment
    join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
    where assignment.employee_id = v_employee_one.id
      and assignment.status = 'ACTIVE'
      and assignment.assignment_type = 'PRIMARY'
      and slot.source = 'workforce_plan'
  ) then
    raise exception 'HRM_WORKFORCE_SMOKE_OFFICIAL_ASSIGNMENT_MISSING';
  end if;
  if not exists (
    select 1 from public.employees employee
    where employee.id = v_employee_one.id
      and employee.org_unit_id = v_org_unit_id
      and employee.position_id = v_position_one.id
  ) then
    raise exception 'HRM_WORKFORCE_SMOKE_EMPLOYEE_PROJECTION_MISSING';
  end if;

  begin
    perform public.adjust_hrm_staffing(
      v_org_unit_id, v_position_one.id, v_position_one.level_code,
      null, 0, 'Smoke: thao tác phải bị chặn'
    );
  exception when others then
    v_blocked := position('HRM_STAFFING_HAS_OCCUPIED_OR_MANAGER_SLOTS' in sqlerrm) > 0;
  end;
  if not v_blocked then
    raise exception 'HRM_WORKFORCE_SMOKE_OCCUPIED_REDUCTION_NOT_BLOCKED';
  end if;

  perform public.unassign_hrm_employee_from_organization(
    v_employee_one.id, current_date, 'Smoke: gỡ phân bổ'
  );
  perform public.adjust_hrm_staffing(
    v_org_unit_id, v_position_one.id, v_position_one.level_code,
    null, 0, 'Smoke: giảm định biên sau khi gỡ người'
  );

  perform public.adjust_hrm_staffing(
    v_org_unit_id, v_position_one.id, v_position_one.level_code,
    null, 1, 'Smoke: tạo vị trí quản lý'
  );
  perform public.set_hrm_unit_manager_staffing(
    v_org_unit_id, v_position_one.id, v_position_one.level_code, null
  );
  select manager_slot_id into v_manager_slot_id
  from public.org_units where id = v_org_unit_id;
  if v_manager_slot_id is null then
    raise exception 'HRM_WORKFORCE_SMOKE_MANAGER_SLOT_MISSING';
  end if;

  perform public.assign_hrm_employee_to_staffing(
    v_employee_one.id, v_org_unit_id, v_position_one.id,
    v_position_one.level_code, null, current_date,
    'Smoke: bố trí quản lý'
  );
  perform public.adjust_hrm_staffing(
    v_org_unit_id, v_position_two.id, v_position_two.level_code,
    null, 1, 'Smoke: tạo vị trí cấp dưới'
  );
  perform public.assign_hrm_employee_to_staffing(
    v_employee_two.id, v_org_unit_id, v_position_two.id,
    v_position_two.level_code, null, current_date,
    'Smoke: bố trí cấp dưới'
  );

  if app_private.resolve_slot_direct_manager(v_employee_two.user_id)
      is distinct from v_employee_one.user_id then
    raise exception 'HRM_WORKFORCE_SMOKE_MANAGER_FALLBACK_FAILED';
  end if;
end;
$$;

rollback;
