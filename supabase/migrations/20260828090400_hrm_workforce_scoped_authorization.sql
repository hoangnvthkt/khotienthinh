begin;

-- Harden the existing workers in-place so legacy callers cannot retain the old
-- technical Admin/module-admin bypass. Abort if their known guard changed.
do $$
declare
  v_worker record;
  v_definition text;
  v_old_guard constant text := $guard$if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;$guard$;
  v_new_guard text;
begin
  for v_worker in
    select * from (values
      ('app_private.adjust_hrm_staffing(uuid,uuid,text,uuid,integer,text)', 'hrm.staffing.manage', 'HRM_STAFFING_MANAGE_REQUIRED'),
      ('app_private.assign_hrm_employee_to_staffing(uuid,uuid,uuid,text,uuid,date,text)', 'hrm.staffing.assign', 'HRM_STAFFING_ASSIGN_REQUIRED'),
      ('app_private.unassign_hrm_employee_from_organization(uuid,date,text)', 'hrm.staffing.assign', 'HRM_STAFFING_ASSIGN_REQUIRED'),
      ('app_private.set_hrm_unit_manager_staffing(uuid,uuid,text,uuid)', 'hrm.staffing.set_manager', 'HRM_STAFFING_SET_MANAGER_REQUIRED')
    ) as worker(signature, permission_code, error_code)
  loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_worker.signature))
      into v_definition;
    if v_definition is null or pg_catalog.strpos(v_definition, v_old_guard) = 0 then
      raise exception 'HRM_WORKFORCE_GUARD_PRECONDITION_FAILED: %', v_worker.signature;
    end if;
    v_new_guard := pg_catalog.format(
      $replacement$if not app_private.current_user_has_hrm_template_permission(%L) then
    raise exception using errcode = '42501', message = %L;
  end if;$replacement$,
      v_worker.permission_code,
      v_worker.error_code
    );
    execute pg_catalog.replace(v_definition, v_old_guard, v_new_guard);
  end loop;
end;
$$;

create or replace function app_private.assert_hrm_mutation_context(
  p_reason text,
  p_source_reference text
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'HRM_MUTATION_REASON_TOO_SHORT';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_source_reference, ''))) = 0 then
    raise exception using errcode = '22023', message = 'HRM_MUTATION_SOURCE_REFERENCE_REQUIRED';
  end if;
end;
$$;

create or replace function app_private.annotate_hrm_workforce_audit(
  p_entity_type text,
  p_source_reference text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.audit_trail
  set context = coalesce(context, '{}'::jsonb)
    || jsonb_build_object('source_reference', pg_catalog.btrim(p_source_reference))
  where xmin = pg_catalog.pg_current_xact_id()::text::xid
    and user_id = public.current_app_user_id()::text
    and entity_type = p_entity_type;
$$;

create or replace function app_private.adjust_hrm_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_target_count integer,
  p_note text,
  p_source_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app_private.assert_hrm_mutation_context(p_note, p_source_reference);
  v_result := app_private.adjust_hrm_staffing(
    p_org_unit_id, p_position_id, p_level_code, p_reports_to_slot_id,
    p_target_count, p_note
  );
  perform app_private.annotate_hrm_workforce_audit('HRM_WORKFORCE_STAFFING', p_source_reference);
  return v_result;
end;
$$;

create or replace function app_private.assign_hrm_employee_to_staffing(
  p_employee_id uuid,
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_effective_from date,
  p_note text,
  p_source_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app_private.assert_hrm_mutation_context(p_note, p_source_reference);
  v_result := app_private.assign_hrm_employee_to_staffing(
    p_employee_id, p_org_unit_id, p_position_id, p_level_code,
    p_reports_to_slot_id, p_effective_from, p_note
  );
  perform app_private.annotate_hrm_workforce_audit('HRM_WORKFORCE_ASSIGNMENT', p_source_reference);
  return v_result;
end;
$$;

create or replace function app_private.unassign_hrm_employee_from_organization(
  p_employee_id uuid,
  p_effective_to date,
  p_note text,
  p_source_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app_private.assert_hrm_mutation_context(p_note, p_source_reference);
  v_result := app_private.unassign_hrm_employee_from_organization(
    p_employee_id, p_effective_to, p_note
  );
  perform app_private.annotate_hrm_workforce_audit('HRM_WORKFORCE_UNASSIGNMENT', p_source_reference);
  return v_result;
end;
$$;

create or replace function app_private.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_reason text,
  p_source_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform app_private.assert_hrm_mutation_context(p_reason, p_source_reference);
  v_result := app_private.set_hrm_unit_manager_staffing(
    p_org_unit_id, p_position_id, p_level_code, p_reports_to_slot_id
  );
  update public.audit_trail
  set context = coalesce(context, '{}'::jsonb) || jsonb_build_object(
    'reason', pg_catalog.btrim(p_reason),
    'source_reference', pg_catalog.btrim(p_source_reference)
  )
  where xmin = pg_catalog.pg_current_xact_id()::text::xid
    and user_id = public.current_app_user_id()::text
    and entity_type = 'HRM_UNIT_MANAGER_STAFFING';
  return v_result;
end;
$$;

-- Context-free public signatures remain as explicit compatibility sentinels.
create or replace function public.adjust_hrm_staffing(
  p_org_unit_id uuid, p_position_id uuid, p_level_code text default null,
  p_reports_to_slot_id uuid default null, p_target_count integer default 0,
  p_note text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'HRM_MUTATION_CONTEXT_REQUIRED'; end;
$$;
create or replace function public.assign_hrm_employee_to_staffing(
  p_employee_id uuid, p_org_unit_id uuid, p_position_id uuid,
  p_level_code text default null, p_reports_to_slot_id uuid default null,
  p_effective_from date default current_date, p_note text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'HRM_MUTATION_CONTEXT_REQUIRED'; end;
$$;
create or replace function public.unassign_hrm_employee_from_organization(
  p_employee_id uuid, p_effective_to date default current_date,
  p_note text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'HRM_MUTATION_CONTEXT_REQUIRED'; end;
$$;
create or replace function public.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid, p_position_id uuid, p_level_code text default null,
  p_reports_to_slot_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'HRM_MUTATION_CONTEXT_REQUIRED'; end;
$$;

create or replace function public.adjust_hrm_staffing(
  p_org_unit_id uuid, p_position_id uuid, p_level_code text,
  p_reports_to_slot_id uuid, p_target_count integer, p_note text,
  p_source_reference text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.adjust_hrm_staffing($1, $2, $3, $4, $5, $6, $7);
$$;
create or replace function public.assign_hrm_employee_to_staffing(
  p_employee_id uuid, p_org_unit_id uuid, p_position_id uuid, p_level_code text,
  p_reports_to_slot_id uuid, p_effective_from date, p_note text,
  p_source_reference text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.assign_hrm_employee_to_staffing($1, $2, $3, $4, $5, $6, $7, $8);
$$;
create or replace function public.unassign_hrm_employee_from_organization(
  p_employee_id uuid, p_effective_to date, p_note text, p_source_reference text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.unassign_hrm_employee_from_organization($1, $2, $3, $4);
$$;
create or replace function public.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid, p_position_id uuid, p_level_code text,
  p_reports_to_slot_id uuid, p_reason text, p_source_reference text
) returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.set_hrm_unit_manager_staffing($1, $2, $3, $4, $5, $6);
$$;

revoke all on function app_private.assert_hrm_mutation_context(text, text) from public, anon, authenticated;
revoke all on function app_private.annotate_hrm_workforce_audit(text, text) from public, anon, authenticated;
revoke all on function app_private.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function app_private.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text, text) from public, anon, authenticated;
revoke all on function app_private.unassign_hrm_employee_from_organization(uuid, date, text, text) from public, anon, authenticated;
revoke all on function app_private.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function app_private.assert_hrm_mutation_context(text, text) to authenticated, service_role;
grant execute on function app_private.annotate_hrm_workforce_audit(text, text) to authenticated, service_role;
grant execute on function app_private.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text, text) to authenticated, service_role;
grant execute on function app_private.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text, text) to authenticated, service_role;
grant execute on function app_private.unassign_hrm_employee_from_organization(uuid, date, text, text) to authenticated, service_role;
grant execute on function app_private.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid, text, text) to authenticated, service_role;

revoke all on function public.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text, text) from public, anon;
revoke all on function public.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text, text) from public, anon;
revoke all on function public.unassign_hrm_employee_from_organization(uuid, date, text, text) from public, anon;
revoke all on function public.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.adjust_hrm_staffing(uuid, uuid, text, uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.assign_hrm_employee_to_staffing(uuid, uuid, uuid, text, uuid, date, text, text) to authenticated, service_role;
grant execute on function public.unassign_hrm_employee_from_organization(uuid, date, text, text) to authenticated, service_role;
grant execute on function public.set_hrm_unit_manager_staffing(uuid, uuid, text, uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
