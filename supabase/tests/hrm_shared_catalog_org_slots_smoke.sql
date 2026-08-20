begin;

do $$
declare
  v_level_count integer;
begin
  if not exists (
    select 1 from public.hrm_position_groups
    where code = 'CG' and is_active
  ) then
    raise exception 'HRM_SMOKE_MISSING_CG_GROUP';
  end if;

  if (select count(*) from public.hrm_catalog_items where catalog_key = 'labor_contract_type' and code = '36T') <> 1 then
    raise exception 'HRM_SMOKE_EXPECTED_ONE_36T_CONTRACT_TYPE';
  end if;

  if exists (
    select 1 from public.hrm_org_blocks where code = 'K4' and is_active
  ) then
    raise exception 'HRM_SMOKE_K4_STILL_ACTIVE';
  end if;

  if exists (
    select 1 from public.hrm_competency_levels where code = 'C6' and is_active
  ) then
    raise exception 'HRM_SMOKE_C6_STILL_ACTIVE';
  end if;

  select count(*) into v_level_count
  from public.hrm_position_levels
  where is_active and code ~ '^E(1[01]|[1-9])$';
  if v_level_count <> 11 then
    raise exception 'HRM_SMOKE_EXPECTED_11_E_LEVELS, found %', v_level_count;
  end if;

  if exists (
    select 1 from public.hrm_positions
    where level_code ~ '^L' or suggested_org_unit_code in ('VPHN', 'BCH CT', 'CG/CV')
  ) then
    raise exception 'HRM_SMOKE_SOURCE_NORMALIZATION_INCOMPLETE';
  end if;

  if exists (
    select employee_id
    from public.hrm_employee_slot_assignments
    where status = 'ACTIVE' and assignment_type = 'PRIMARY'
    group by employee_id having count(*) > 1
  ) then
    raise exception 'HRM_SMOKE_DUPLICATE_ACTIVE_PRIMARY_EMPLOYEE';
  end if;

  if exists (
    select slot_id
    from public.hrm_employee_slot_assignments
    where status = 'ACTIVE' and assignment_type in ('PRIMARY', 'ACTING')
    group by slot_id having count(*) > 1
  ) then
    raise exception 'HRM_SMOKE_DUPLICATE_ACTIVE_SLOT_OCCUPANT';
  end if;

  if exists (
    select 1
    from public.org_units org
    join public.hrm_org_position_slots slot on slot.id = org.manager_slot_id
    where slot.org_unit_id <> org.id
  ) then
    raise exception 'HRM_SMOKE_MANAGER_SLOT_OUTSIDE_UNIT';
  end if;
end;
$$;

rollback;
