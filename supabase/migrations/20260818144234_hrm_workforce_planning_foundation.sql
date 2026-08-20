begin;

-- The organization unit and construction-site catalogs use different primary keys.
-- This explicit bridge is the only value copied to employees.construction_site_id.
alter table public.org_units
  add column if not exists linked_construction_site_id uuid
  references public.hrm_construction_sites(id) on delete set null;

create index if not exists org_units_linked_construction_site_idx
  on public.org_units(linked_construction_site_id)
  where linked_construction_site_id is not null;

create index if not exists hrm_workforce_plan_vacancy_idx
  on public.hrm_org_position_slots (
    org_unit_id, position_id, level_code, reports_to_slot_id, id
  )
  where source = 'workforce_plan' and status = 'ACTIVE';

create or replace function app_private.adjust_hrm_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_target_count integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_unit public.org_units%rowtype;
  v_position public.hrm_positions%rowtype;
  v_current_count integer := 0;
  v_occupied_count integer := 0;
  v_change_count integer := 0;
  v_requested_remove integer := 0;
  v_level_code text := nullif(trim(p_level_code), '');
  v_index integer;
  v_code text;
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;
  v_actor_id := public.current_app_user_id();
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'HRM_ACTIVE_ACTOR_REQUIRED';
  end if;
  if p_target_count is null or p_target_count < 0 then
    raise exception using errcode = '22023', message = 'HRM_STAFFING_TARGET_INVALID';
  end if;

  select * into v_unit
  from public.org_units
  where id = p_org_unit_id and is_active
  for update;
  if v_unit.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_ORG_UNIT_NOT_FOUND';
  end if;

  select * into v_position
  from public.hrm_positions
  where id = p_position_id and is_active
  for update;
  if v_position.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_POSITION_NOT_FOUND';
  end if;

  if v_level_code is not null and not exists (
    select 1 from public.hrm_position_levels level
    where level.code = v_level_code and level.is_active
  ) then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_LEVEL_NOT_FOUND';
  end if;

  if p_reports_to_slot_id is not null and not exists (
    select 1 from public.hrm_org_position_slots manager_slot
    where manager_slot.id = p_reports_to_slot_id
      and manager_slot.status = 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_REPORTING_SLOT_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws('|', p_org_unit_id::text, p_position_id::text,
        coalesce(v_level_code, ''), coalesce(p_reports_to_slot_id::text, '')),
      0
    )
  );

  select count(*)::integer,
         count(assignment.id)::integer
  into v_current_count, v_occupied_count
  from public.hrm_org_position_slots slot
  left join public.hrm_employee_slot_assignments assignment
    on assignment.slot_id = slot.id
   and assignment.status = 'ACTIVE'
   and assignment.assignment_type in ('PRIMARY', 'ACTING')
  where slot.source = 'workforce_plan'
    and slot.status = 'ACTIVE'
    and slot.org_unit_id = p_org_unit_id
    and slot.position_id = p_position_id
    and slot.level_code is not distinct from v_level_code
    and slot.reports_to_slot_id is not distinct from p_reports_to_slot_id;

  if p_target_count > v_current_count then
    for v_index in 1..(p_target_count - v_current_count) loop
      v_code := 'WF-' ||
        left(regexp_replace(upper(coalesce(v_unit.code, 'ORG')), '[^A-Z0-9]+', '', 'g'), 12) || '-' ||
        left(regexp_replace(upper(coalesce(v_position.code, 'POS')), '[^A-Z0-9]+', '', 'g'), 12) || '-' ||
        left(replace(gen_random_uuid()::text, '-', ''), 8);

      insert into public.hrm_org_position_slots (
        code, org_unit_id, position_id, level_code, reports_to_slot_id,
        slot_type, status, description, effective_from, sort_order, source,
        created_by, updated_by
      ) values (
        v_code, p_org_unit_id, p_position_id, v_level_code, p_reports_to_slot_id,
        'STANDARD', 'ACTIVE', nullif(trim(p_note), ''), current_date,
        v_current_count + v_index, 'workforce_plan', v_actor_id, v_actor_id
      );
      v_change_count := v_change_count + 1;
    end loop;
  elsif p_target_count < v_current_count then
    v_requested_remove := v_current_count - p_target_count;

    with vacant_candidates as (
      select slot.id
      from public.hrm_org_position_slots slot
      where slot.source = 'workforce_plan'
        and slot.status = 'ACTIVE'
        and slot.org_unit_id = p_org_unit_id
        and slot.position_id = p_position_id
        and slot.level_code is not distinct from v_level_code
        and slot.reports_to_slot_id is not distinct from p_reports_to_slot_id
        and slot.id is distinct from v_unit.manager_slot_id
        and not exists (
          select 1
          from public.hrm_employee_slot_assignments assignment
          where assignment.slot_id = slot.id
            and assignment.status = 'ACTIVE'
            and assignment.assignment_type in ('PRIMARY', 'ACTING')
        )
      order by slot.id
      for update skip locked
      limit v_requested_remove
    ), archived as (
      update public.hrm_org_position_slots slot
      set status = 'ARCHIVED',
          effective_to = greatest(slot.effective_from, current_date),
          description = concat_ws(E'\n', nullif(slot.description, ''), nullif(trim(p_note), '')),
          updated_by = v_actor_id,
          updated_at = now()
      where slot.id in (select candidate.id from vacant_candidates candidate)
      returning slot.id
    )
    select count(*)::integer into v_change_count from archived;

    if v_change_count <> v_requested_remove then
      raise exception using errcode = '55000', message = 'HRM_STAFFING_HAS_OCCUPIED_OR_MANAGER_SLOTS';
    end if;
  end if;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level, context
  ) values (
    'hrm_org_position_slots', p_org_unit_id::text, 'UPDATE',
    jsonb_build_object('planned_count', v_current_count, 'occupied_count', v_occupied_count),
    jsonb_build_object('planned_count', p_target_count,
      'occupied_count', least(v_occupied_count, p_target_count)),
    v_actor_id::text, 'HRM', 'Điều chỉnh định biên nhân sự',
    v_unit.name || ' — ' || v_position.name, 'HRM_WORKFORCE_STAFFING',
    array['planned_count'], v_change_count, 'high',
    jsonb_build_object('note', nullif(trim(p_note), ''), 'level_code', v_level_code,
      'reports_to_slot_id', p_reports_to_slot_id)
  );

  return jsonb_build_object(
    'org_unit_id', p_org_unit_id,
    'position_id', p_position_id,
    'level_code', v_level_code,
    'reports_to_slot_id', p_reports_to_slot_id,
    'planned_count', p_target_count,
    'occupied_count', least(v_occupied_count, p_target_count),
    'vacant_count', greatest(p_target_count - v_occupied_count, 0),
    'changed_count', v_change_count
  );
end;
$$;

create or replace function public.adjust_hrm_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text default null,
  p_reports_to_slot_id uuid default null,
  p_target_count integer default 0,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.adjust_hrm_staffing(
    p_org_unit_id, p_position_id, p_level_code, p_reports_to_slot_id,
    p_target_count, p_note
  );
$$;

create or replace function app_private.assign_hrm_employee_to_staffing(
  p_employee_id uuid,
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_effective_from date,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_employee public.employees%rowtype;
  v_unit public.org_units%rowtype;
  v_position public.hrm_positions%rowtype;
  v_slot public.hrm_org_position_slots%rowtype;
  v_assignment public.hrm_employee_slot_assignments%rowtype;
  v_old_assignment jsonb := '{}'::jsonb;
  v_level_code text := nullif(trim(p_level_code), '');
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;
  v_actor_id := public.current_app_user_id();
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'HRM_ACTIVE_ACTOR_REQUIRED';
  end if;
  if p_effective_from is null or p_effective_from > current_date then
    raise exception using errcode = '22023', message = 'HRM_ASSIGNMENT_FUTURE_DATE_NOT_ALLOWED';
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id and status = 'Đang làm việc'
  for update;
  if v_employee.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_unit
  from public.org_units
  where id = p_org_unit_id and is_active;
  if v_unit.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_ORG_UNIT_NOT_FOUND';
  end if;

  select * into v_position
  from public.hrm_positions
  where id = p_position_id and is_active;
  if v_position.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_POSITION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws('|', p_org_unit_id::text, p_position_id::text,
        coalesce(v_level_code, ''), coalesce(p_reports_to_slot_id::text, '')),
      0
    )
  );

  select slot.* into v_slot
  from public.hrm_org_position_slots slot
  where slot.source = 'workforce_plan'
    and slot.status = 'ACTIVE'
    and slot.org_unit_id = p_org_unit_id
    and slot.position_id = p_position_id
    and slot.level_code is not distinct from v_level_code
    and slot.reports_to_slot_id is not distinct from p_reports_to_slot_id
    and slot.effective_from <= p_effective_from
    and (slot.effective_to is null or slot.effective_to >= p_effective_from)
    and not exists (
      select 1
      from public.hrm_employee_slot_assignments occupant
      where occupant.slot_id = slot.id
        and occupant.status = 'ACTIVE'
        and occupant.assignment_type in ('PRIMARY', 'ACTING')
    )
  order by slot.id
  for update skip locked
  limit 1;
  if v_slot.id is null then
    raise exception using errcode = '55000', message = 'HRM_STAFFING_NO_VACANCY';
  end if;

  select coalesce(jsonb_agg(to_jsonb(active_assignment)), '[]'::jsonb)
  into v_old_assignment
  from public.hrm_employee_slot_assignments active_assignment
  where active_assignment.employee_id = p_employee_id
    and active_assignment.status = 'ACTIVE'
    and active_assignment.assignment_type = 'PRIMARY';

  update public.hrm_employee_slot_assignments
  set status = 'ENDED',
      effective_to = greatest(effective_from, p_effective_from),
      note = concat_ws(E'\n', nullif(note, ''), nullif(trim(p_note), '')),
      updated_by = v_actor_id,
      updated_at = now()
  where employee_id = p_employee_id
    and status = 'ACTIVE'
    and assignment_type = 'PRIMARY';

  insert into public.hrm_employee_slot_assignments (
    employee_id, slot_id, assignment_type, status, effective_from,
    note, source, created_by, updated_by
  ) values (
    p_employee_id, v_slot.id, 'PRIMARY', 'ACTIVE', p_effective_from,
    nullif(trim(p_note), ''), 'workforce_plan', v_actor_id, v_actor_id
  ) returning * into v_assignment;

  update public.employees
  set org_unit_id = p_org_unit_id,
      position_id = p_position_id,
      title = v_position.name,
      department_id = case when v_unit.type = 'department' then v_unit.id else null end,
      factory_id = case when v_unit.type = 'factory' then v_unit.id else null end,
      construction_site_id = case
        when v_unit.type = 'construction_site' then v_unit.linked_construction_site_id
        else null
      end,
      updated_at = now()
  where id = p_employee_id;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level, context
  ) values (
    'hrm_employee_slot_assignments', v_assignment.id::text, 'INSERT',
    jsonb_build_object('assignments', v_old_assignment,
      'org_unit_id', v_employee.org_unit_id, 'position_id', v_employee.position_id),
    jsonb_build_object('assignment', to_jsonb(v_assignment),
      'org_unit_id', p_org_unit_id, 'position_id', p_position_id),
    v_actor_id::text, 'HRM', 'Phân bổ hoặc chuyển vị trí nhân sự',
    v_employee.full_name, 'HRM_WORKFORCE_ASSIGNMENT',
    array['org_unit_id', 'position_id', 'slot_id'], 3, 'high',
    jsonb_build_object('note', nullif(trim(p_note), ''))
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'status', 'ASSIGNED',
    'assignment_id', v_assignment.id,
    'slot_id', v_slot.id,
    'org_unit_id', p_org_unit_id,
    'org_unit_name', v_unit.name,
    'position_id', p_position_id,
    'position_name', v_position.name,
    'level_code', v_level_code
  );
end;
$$;

create or replace function public.assign_hrm_employee_to_staffing(
  p_employee_id uuid,
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text default null,
  p_reports_to_slot_id uuid default null,
  p_effective_from date default current_date,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.assign_hrm_employee_to_staffing(
    p_employee_id, p_org_unit_id, p_position_id, p_level_code,
    p_reports_to_slot_id, p_effective_from, p_note
  );
$$;

create or replace function app_private.unassign_hrm_employee_from_organization(
  p_employee_id uuid,
  p_effective_to date,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_employee public.employees%rowtype;
  v_old_assignments jsonb;
  v_ended_count integer := 0;
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;
  v_actor_id := public.current_app_user_id();
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'HRM_ACTIVE_ACTOR_REQUIRED';
  end if;
  if p_effective_to is null or p_effective_to > current_date then
    raise exception using errcode = '22023', message = 'HRM_UNASSIGN_FUTURE_DATE_NOT_ALLOWED';
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id and status = 'Đang làm việc'
  for update;
  if v_employee.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_EMPLOYEE_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(to_jsonb(assignment)), '[]'::jsonb)
  into v_old_assignments
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  where assignment.employee_id = p_employee_id
    and assignment.status = 'ACTIVE'
    and assignment.assignment_type = 'PRIMARY'
    and slot.source = 'workforce_plan';

  update public.hrm_employee_slot_assignments assignment
  set status = 'ENDED',
      effective_to = greatest(assignment.effective_from, p_effective_to),
      note = concat_ws(E'\n', nullif(assignment.note, ''), nullif(trim(p_note), '')),
      updated_by = v_actor_id,
      updated_at = now()
  from public.hrm_org_position_slots slot
  where assignment.slot_id = slot.id
    and assignment.employee_id = p_employee_id
    and assignment.status = 'ACTIVE'
    and assignment.assignment_type = 'PRIMARY'
    and slot.source = 'workforce_plan';
  get diagnostics v_ended_count = row_count;

  if v_ended_count = 0 then
    raise exception using errcode = '22023', message = 'HRM_OFFICIAL_ASSIGNMENT_NOT_FOUND';
  end if;

  -- Phase 1 deliberately preserves employee organization/position snapshots for
  -- compatibility with modules that have not migrated to official assignments yet.
  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level, context
  ) values (
    'hrm_employee_slot_assignments', p_employee_id::text, 'UPDATE',
    jsonb_build_object('assignments', v_old_assignments),
    jsonb_build_object('status', 'PENDING_ALLOCATION',
      'compatibility_snapshot_preserved', true),
    v_actor_id::text, 'HRM', 'Gỡ nhân sự khỏi cơ cấu tổ chức chính thức',
    v_employee.full_name, 'HRM_WORKFORCE_UNASSIGNMENT',
    array['status', 'effective_to'], 2, 'high',
    jsonb_build_object('note', nullif(trim(p_note), ''))
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'status', 'PENDING_ALLOCATION',
    'assignment_id', null,
    'slot_id', null,
    'org_unit_id', null,
    'org_unit_name', null,
    'position_id', null,
    'position_name', null,
    'level_code', null
  );
end;
$$;

create or replace function public.unassign_hrm_employee_from_organization(
  p_employee_id uuid,
  p_effective_to date default current_date,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.unassign_hrm_employee_from_organization(
    p_employee_id, p_effective_to, p_note
  );
$$;

create or replace function app_private.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_unit public.org_units%rowtype;
  v_manager_slot_id uuid;
  v_slot_count integer;
  v_level_code text := nullif(trim(p_level_code), '');
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;
  v_actor_id := public.current_app_user_id();
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'HRM_ACTIVE_ACTOR_REQUIRED';
  end if;

  select * into v_unit
  from public.org_units
  where id = p_org_unit_id and is_active
  for update;
  if v_unit.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_ORG_UNIT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.hrm_positions position
    where position.id = p_position_id and position.is_active
  ) then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_POSITION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws('|', p_org_unit_id::text, p_position_id::text,
        coalesce(v_level_code, ''), coalesce(p_reports_to_slot_id::text, '')),
      0
    )
  );

  select count(*)::integer, (array_agg(slot.id order by slot.id))[1]
  into v_slot_count, v_manager_slot_id
  from public.hrm_org_position_slots slot
  where slot.source = 'workforce_plan'
    and slot.status = 'ACTIVE'
    and slot.org_unit_id = p_org_unit_id
    and slot.position_id = p_position_id
    and slot.level_code is not distinct from v_level_code
    and slot.reports_to_slot_id is not distinct from p_reports_to_slot_id;

  if v_slot_count <> 1 then
    raise exception using errcode = '22023', message = 'HRM_MANAGER_STAFFING_MUST_HAVE_ONE_SLOT';
  end if;

  update public.org_units
  set manager_slot_id = v_manager_slot_id
  where id = p_org_unit_id;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level
  ) values (
    'org_units', p_org_unit_id::text, 'UPDATE',
    jsonb_build_object('manager_slot_id', v_unit.manager_slot_id),
    jsonb_build_object('manager_slot_id', v_manager_slot_id),
    v_actor_id::text, 'HRM', 'Thiết lập định biên quản lý trực tiếp',
    v_unit.name, 'HRM_UNIT_MANAGER_STAFFING', array['manager_slot_id'], 1, 'high'
  );

  return jsonb_build_object(
    'org_unit_id', p_org_unit_id,
    'manager_slot_id', v_manager_slot_id,
    'position_id', p_position_id,
    'level_code', v_level_code,
    'reports_to_slot_id', p_reports_to_slot_id
  );
end;
$$;

create or replace function public.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text default null,
  p_reports_to_slot_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.set_hrm_unit_manager_staffing(
    p_org_unit_id, p_position_id, p_level_code, p_reports_to_slot_id
  );
$$;

revoke all on function app_private.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function app_private.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text)
  from public, anon, authenticated;
revoke all on function app_private.unassign_hrm_employee_from_organization(uuid, date, text)
  from public, anon, authenticated;
revoke all on function app_private.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- app_private is not exposed by PostgREST. The invoker wrappers still need execute
-- permission on their workers so PostgreSQL can complete the nested call.
grant execute on function app_private.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text)
  to authenticated, service_role;
grant execute on function app_private.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text)
  to authenticated, service_role;
grant execute on function app_private.unassign_hrm_employee_from_organization(uuid, date, text)
  to authenticated, service_role;
grant execute on function app_private.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid)
  to authenticated, service_role;

revoke all on function public.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text)
  from public, anon;
revoke all on function public.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text)
  from public, anon;
revoke all on function public.unassign_hrm_employee_from_organization(uuid, date, text)
  from public, anon;
revoke all on function public.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid)
  from public, anon;

grant execute on function public.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text)
  to authenticated, service_role;
grant execute on function public.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text)
  to authenticated, service_role;
grant execute on function public.unassign_hrm_employee_from_organization(uuid, date, text)
  to authenticated, service_role;
grant execute on function public.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid)
  to authenticated, service_role;

comment on column public.org_units.linked_construction_site_id is
  'Explicit bridge to hrm_construction_sites; never substitute org_units.id.';
comment on index public.hrm_workforce_plan_vacancy_idx is
  'Supports grouped official workforce-plan rows and deterministic vacancy claims.';

notify pgrst, 'reload schema';

commit;
