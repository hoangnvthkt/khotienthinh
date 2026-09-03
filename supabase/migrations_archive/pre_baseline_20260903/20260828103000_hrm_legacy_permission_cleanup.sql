begin;

do $$
declare
  v_hr_template_id uuid;
  v_user record;
  v_assignment_id uuid;
  v_before jsonb;
begin
  select template.id into v_hr_template_id
  from public.role_permission_templates template
  where template.code = 'HR' and template.is_system and template.is_active;
  if v_hr_template_id is null then
    raise exception using errcode = '55000', message = 'HR_TEMPLATE_REQUIRED_FOR_LEGACY_BACKFILL';
  end if;

  for v_user in
    select grant_row.user_id, max(grant_row.granted_by::text)::uuid as granted_by
    from public.user_permission_grants grant_row
    where grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and grant_row.permission_code in ('hrm.employee.view','hrm.employee.create','hrm.employee.edit')
      and grant_row.scope_type = 'global' and grant_row.scope_id = '*'
    group by grant_row.user_id
    having count(distinct grant_row.permission_code) = 3
  loop
    select coalesce(jsonb_agg(to_jsonb(grant_row) order by grant_row.permission_code), '[]'::jsonb)
    into v_before
    from public.user_permission_grants grant_row
    where grant_row.user_id = v_user.user_id and grant_row.is_active
      and grant_row.permission_code in ('hrm.employee.view','hrm.employee.create','hrm.employee.edit');

    if not exists (
      select 1
      from public.principal_role_assignments assignment_row
      join public.role_permission_templates template on template.id = assignment_row.role_template_id
      where assignment_row.principal_type = 'user'
        and assignment_row.principal_id = v_user.user_id
        and assignment_row.status = 'ACTIVE'
        and assignment_row.starts_at <= now()
        and (assignment_row.expires_at is null or assignment_row.expires_at > now())
        and template.code in ('HR','HR_MANAGE')
    ) then
      insert into public.principal_role_assignments(
        principal_type, principal_id, role_template_id, scope_type, scope_id,
        starts_at, status, assigned_by, assigned_reason
      ) values (
        'user', v_user.user_id, v_hr_template_id, 'global', '*', now(), 'ACTIVE',
        v_user.granted_by, 'Backfill từ bộ quyền HRM legacy view/create/edit'
      ) returning id into v_assignment_id;

      insert into public.permission_audit_events(
        actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
      ) values (
        v_user.granted_by, v_user.user_id, 'hr_business_role_legacy_backfill', v_before,
        jsonb_build_array(jsonb_build_object(
          'assignmentId', v_assignment_id, 'roleCode', 'HR', 'scopeType', 'global', 'scopeId', '*'
        )),
        jsonb_build_object(
          'reason', 'Backfill từ bộ quyền HRM legacy view/create/edit',
          'legacyPermissionCodes', array['hrm.employee.view','hrm.employee.create','hrm.employee.edit']
        )
      );
    end if;
  end loop;
end;
$$;

update public.user_permission_grants
set is_active = false,
    revoked_at = now(),
    revoked_by = coalesce(revoked_by, granted_by),
    revoked_reason = 'Đã chuyển sang template HR/HR_MANAGE trong cutover HRM',
    updated_at = now()
where is_active
  and permission_code in ('hrm.employee.view','hrm.employee.create','hrm.employee.edit');

update public.permission_actions
set is_active = false, updated_at = now()
where permission_code in ('hrm.employee.view','hrm.employee.create','hrm.employee.edit');

update public.permission_actions
set scope_modes = array_remove(scope_modes, 'department'), updated_at = now()
where access_application_code = 'hrm' and 'department' = any(scope_modes);

create or replace function app_private.can_manage_hrm_employees()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_hrm_template_permission(
    public.current_app_user_id(), 'hrm.employee.edit_profile'
  );
$$;

create or replace function app_private.can_view_hrm_payroll_3p()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.view')
      or app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.view');
$$;

create or replace function app_private.can_manage_hrm_payroll_3p()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.manage')
      or app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.manage');
$$;

create or replace function app_private.hrm_has_action(
  p_permission_code text,
  p_target_user_id uuid default null,
  p_department_id text default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_permission_code like 'hrm.%'
    and p_user_id is not null
    and (
      app_private.has_governed_hrm_permission(p_user_id, p_permission_code, 'global', '*')
      or (p_target_user_id = p_user_id
        and app_private.has_governed_hrm_permission(p_user_id, p_permission_code, 'own', p_user_id::text))
      or (p_assigned_user_id = p_user_id
        and app_private.has_governed_hrm_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text))
    );
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('app_private.employee_camera_checkin_v1(text,uuid,text,text,double precision,double precision,text,text,text,integer,boolean,text,jsonb)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'if not public.is_admin() and not app_private.hrm_employee_is_current_user(p_employee_id::text) then',
    'if not app_private.has_governed_hrm_permission(v_app_user_id, ''hrm.attendance.edit'') and not app_private.hrm_employee_is_current_user(p_employee_id::text) then'
  );
  execute v_definition;

  select pg_get_functiondef('app_private.review_attendance_proposal_v1(uuid,text,text)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'v_can_review := public.is_admin()
    or app_private.hrm_is_location_manager(v_proposal."locationType", v_proposal."locationId");',
    'v_can_review := app_private.has_governed_hrm_permission(v_app_user_id, ''hrm.attendance.approve'')
    or app_private.hrm_is_location_manager(v_proposal."locationType", v_proposal."locationId");'
  );
  execute v_definition;

  select pg_get_functiondef('app_private.migrate_hrm_legacy_position(uuid,uuid)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'if not (public.is_admin() or public.is_module_admin(''HRM'')) then',
    'if not app_private.has_hrm_template_permission(public.current_app_user_id(), ''hrm.master_data.manage'') then'
  );
  execute v_definition;
end;
$$;

drop policy if exists employees_active_actor_gate on public.employees;
drop policy if exists employees_delete on public.employees;
drop policy if exists employees_insert_action on public.employees;
drop policy if exists employees_select_action on public.employees;
drop policy if exists employees_update_action on public.employees;

drop function if exists public.assign_hrm_employee_to_slot(uuid,uuid,date,text,uuid);
drop function if exists public.search_hrm_documents(text,text);

create or replace function app_private.get_permission_health_summary_impl_v2()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_raw jsonb := app_private.get_permission_health_summary_impl();
  v_base_status text := coalesce(app_private.get_permission_health_summary_legacy_base() ->> 'status', 'ok');
  v_checks jsonb;
  v_admin_bypass jsonb := '[]'::jsonb;
  v_legacy_bypass jsonb := '[]'::jsonb;
  v_status text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', namespace.nspname, 'function', procedure.proname,
    'identityArguments', pg_get_function_identity_arguments(procedure.oid), 'severity', 'critical'
  ) order by namespace.nspname, procedure.proname), '[]'::jsonb)
  into v_admin_bypass
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public','app_private')
    and procedure.prokind in ('f','p')
    and procedure.proname ~* '(hrm|employee|attendance|payroll)'
    and procedure.proname not like 'get_permission_health_summary%'
    and pg_get_functiondef(procedure.oid) ~* '(public\.)?is_(module_)?admin\s*\(';

  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', namespace.nspname, 'function', procedure.proname,
    'identityArguments', pg_get_function_identity_arguments(procedure.oid), 'severity', 'high'
  ) order by namespace.nspname, procedure.proname), '[]'::jsonb)
  into v_legacy_bypass
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public','app_private')
    and procedure.prokind in ('f','p')
    and procedure.proname ~* '(hrm|employee|attendance|payroll)'
    and procedure.proname not like 'get_permission_health_summary%'
    and pg_get_functiondef(procedure.oid) ~* '(is_module_admin|system\.hrm\.manage)';

  v_checks := coalesce(v_raw -> 'checks', '{}'::jsonb) || jsonb_build_object(
    'hrAdminImplicitBypass', v_admin_bypass,
    'hrmLegacyAdminPolicies', v_legacy_bypass
  );
  v_status := v_base_status;
  if jsonb_array_length(coalesce(v_checks -> 'anonSensitiveSelect','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(v_checks -> 'hrmSensitiveBroadRead','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(v_checks -> 'hrSensitiveGrantOutsideApprovedTemplate','[]'::jsonb)) > 0
    or jsonb_array_length(v_admin_bypass) > 0
  then v_status := 'critical';
  elsif v_status = 'ok' and (
    jsonb_array_length(coalesce(v_checks -> 'hrmRawTableExposure','[]'::jsonb)) > 0
    or jsonb_array_length(v_legacy_bypass) > 0
    or jsonb_array_length(coalesce(v_checks -> 'hrTemplateDefinitionDrift','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(v_checks -> 'hrmManagerReadiness','[]'::jsonb)) > 0
  ) then v_status := 'warning';
  end if;
  return v_raw || jsonb_build_object('generatedAt',now(),'status',v_status,'checks',v_checks);
end;
$$;

create or replace function public.get_permission_health_summary()
returns jsonb language sql stable set search_path = '' as $$
  select app_private.get_permission_health_summary_impl_v2();
$$;

revoke all on function app_private.get_permission_health_summary_impl_v2() from public,anon;
grant execute on function app_private.get_permission_health_summary_impl_v2() to authenticated;
revoke all on function public.get_permission_health_summary() from public,anon;
grant execute on function public.get_permission_health_summary() to authenticated;

notify pgrst, 'reload schema';
commit;
