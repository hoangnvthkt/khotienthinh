begin;

create or replace function app_private.migrate_hrm_legacy_position(
  p_legacy_position_id uuid,
  p_target_position_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_legacy public.hrm_positions%rowtype;
  v_target public.hrm_positions%rowtype;
  v_employee_count integer := 0;
  v_slot_count integer := 0;
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;
  if p_legacy_position_id = p_target_position_id then
    raise exception using errcode = '22023', message = 'HRM_POSITION_TARGET_MUST_DIFFER';
  end if;

  v_actor_id := public.current_app_user_id();

  select * into v_legacy
  from public.hrm_positions
  where id = p_legacy_position_id
  for update;
  if v_legacy.id is null or v_legacy.source <> 'legacy' then
    raise exception using errcode = '22023', message = 'HRM_LEGACY_POSITION_REQUIRED';
  end if;

  select * into v_target
  from public.hrm_positions
  where id = p_target_position_id
    and source <> 'legacy'
    and is_active
  for update;
  if v_target.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_TARGET_POSITION_REQUIRED';
  end if;

  update public.employees
  set position_id = p_target_position_id,
      title = v_target.name,
      updated_at = now()
  where position_id = p_legacy_position_id;
  get diagnostics v_employee_count = row_count;

  update public.hrm_org_position_slots
  set position_id = p_target_position_id,
      level_code = v_target.level_code,
      updated_by = v_actor_id,
      updated_at = now(),
      description = concat_ws(E'\n', nullif(description, ''),
        'Chuyển từ vị trí LEGACY ' || coalesce(v_legacy.name, p_legacy_position_id::text))
  where position_id = p_legacy_position_id;
  get diagnostics v_slot_count = row_count;

  update public.hrm_positions
  set is_active = false
  where id = p_legacy_position_id;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count, impact_level
  ) values (
    'hrm_positions', p_legacy_position_id::text, 'UPDATE', to_jsonb(v_legacy),
    jsonb_build_object(
      'target_position_id', p_target_position_id,
      'target_position_code', v_target.code,
      'target_position_name', v_target.name,
      'employees_migrated', v_employee_count,
      'slots_migrated', v_slot_count,
      'legacy_position_archived', true
    ),
    v_actor_id::text, 'HRM', 'Chuyển đổi vị trí LEGACY sang vị trí dùng chung',
    coalesce(v_legacy.name, p_legacy_position_id::text), 'HRM_POSITION_MIGRATION',
    array['position_id', 'title', 'level_code', 'is_active'], 4, 'high'
  );

  return jsonb_build_object(
    'legacy_position_id', p_legacy_position_id,
    'target_position_id', p_target_position_id,
    'employees_migrated', v_employee_count,
    'slots_migrated', v_slot_count
  );
end;
$$;

create or replace function public.migrate_hrm_legacy_position(
  p_legacy_position_id uuid,
  p_target_position_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.migrate_hrm_legacy_position(
    p_legacy_position_id,
    p_target_position_id
  );
$$;

revoke all on function app_private.migrate_hrm_legacy_position(uuid, uuid)
  from public, anon;
revoke all on function public.migrate_hrm_legacy_position(uuid, uuid)
  from public, anon;
grant execute on function app_private.migrate_hrm_legacy_position(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.migrate_hrm_legacy_position(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
