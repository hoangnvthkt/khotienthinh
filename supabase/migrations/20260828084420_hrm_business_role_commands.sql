-- Governed HR / HR Manage preview, apply and System Admin self-grant commands.

begin;

create or replace function app_private.assert_hrm_role_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null
    or not app_private.has_permission(
      v_actor_user_id,
      'system.authorization.manage_roles',
      'global',
      '*'
    )
    or not exists (
      select 1
      from public.users actor_row
      join public.principal_role_assignments assignment_row
        on assignment_row.principal_type = 'user'
       and assignment_row.principal_id = actor_row.id
       and assignment_row.status = 'ACTIVE'
       and assignment_row.starts_at <= now()
       and (assignment_row.expires_at is null or assignment_row.expires_at > now())
      join public.role_permission_templates template
        on template.id = assignment_row.role_template_id
       and template.code = 'SYSTEM_ADMIN'
       and template.is_active
      where actor_row.id = v_actor_user_id
        and actor_row.role = 'ADMIN'
        and actor_row.is_active
        and actor_row.account_status = 'ACTIVE'
    )
  then
    raise exception 'Active System Admin with role-management permission required'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function app_private.hrm_authorization_fingerprint(
  p_target_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'assignmentId', assignment_row.id,
        'roleCode', template.code,
        'templateVersion', template.version,
        'scopeType', assignment_row.scope_type,
        'scopeId', assignment_row.scope_id,
        'startsAt', assignment_row.starts_at,
        'expiresAt', assignment_row.expires_at,
        'updatedAt', assignment_row.updated_at
      )
      order by template.code, assignment_row.id
    )::text
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template
      on template.id = assignment_row.role_template_id
     and template.code in ('HR', 'HR_MANAGE')
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  ), '[]'));
$$;

create or replace function app_private.get_user_hr_authorization_impl(
  p_target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_target public.users%rowtype;
  v_employee_id uuid;
  v_employee_code text;
  v_assignment_id uuid;
  v_hr_role text;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_direct_report_count integer := 0;
  v_effective_permissions jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
begin
  if v_actor_user_id is null
    or (
      v_actor_user_id is distinct from p_target_user_id
      and not app_private.has_any_permission(
        v_actor_user_id,
        array[
          'system.authorization.view',
          'system.authorization.audit',
          'system.authorization.manage_roles',
          'system.authorization.manage_grants'
        ],
        'global',
        '*'
      )
    )
  then
    raise exception 'Not allowed to view HR authorization'
      using errcode = '42501';
  end if;

  select * into v_target
  from public.users target_row
  where target_row.id = p_target_user_id;

  if v_target.id is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  select employee.id, employee.employee_code
  into v_employee_id, v_employee_code
  from public.employees employee
  where employee.user_id = p_target_user_id
  order by employee.created_at
  limit 1;

  select assignment_row.id, template.code, assignment_row.starts_at, assignment_row.expires_at
  into v_assignment_id, v_hr_role, v_starts_at, v_expires_at
  from public.principal_role_assignments assignment_row
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id
   and template.code in ('HR', 'HR_MANAGE')
  where assignment_row.principal_type = 'user'
    and assignment_row.principal_id = p_target_user_id
    and assignment_row.status = 'ACTIVE'
    and assignment_row.starts_at <= now()
    and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  order by case template.code when 'HR_MANAGE' then 0 else 1 end,
           assignment_row.created_at desc
  limit 1;

  select count(*)::integer into v_direct_report_count
  from public.employees report
  where report.user_id is not null
    and report.user_id is distinct from p_target_user_id
    and report.status = 'Đang làm việc'
    and app_private.resolve_slot_direct_manager(report.user_id) = p_target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionCode', source_row.permission_code,
    'sourceType', source_row.source_type,
    'sourceId', source_row.source_id,
    'sourceCode', source_row.source_code,
    'sourceLabel', source_row.source_label,
    'scopeType', source_row.scope_type,
    'scopeId', source_row.scope_id,
    'startsAt', source_row.starts_at,
    'expiresAt', source_row.expires_at,
    'riskLevel', source_row.risk_level,
    'isBusinessApproval', source_row.is_business_approval,
    'metadata', source_row.metadata
  ) order by source_row.permission_code, source_row.scope_type, source_row.scope_id), '[]'::jsonb)
  into v_effective_permissions
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  ) source_row
  where source_row.permission_code like 'hrm.%';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history_row.id,
    'eventType', history_row.event_type,
    'actorUserId', history_row.actor_user_id,
    'actorName', history_row.actor_name,
    'createdAt', history_row.created_at,
    'metadata', history_row.metadata
  ) order by history_row.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select event_row.id, event_row.event_type, event_row.actor_user_id,
           actor_row.name as actor_name, event_row.created_at, event_row.metadata
    from public.permission_audit_events event_row
    left join public.users actor_row on actor_row.id = event_row.actor_user_id
    where event_row.target_user_id = p_target_user_id
      and (
        event_row.event_type like 'hr_business_role_%'
        or event_row.event_type in ('business_role_assigned', 'business_role_revoked')
      )
    order by event_row.created_at desc
    limit 50
  ) history_row;

  return jsonb_build_object(
    'targetUserId', v_target.id,
    'systemRole', v_target.role,
    'employeeId', v_employee_id,
    'employeeCode', v_employee_code,
    'isDirectManager', v_direct_report_count > 0,
    'directReportCount', v_direct_report_count,
    'hrRole', v_hr_role,
    'assignmentId', v_assignment_id,
    'startsAt', v_starts_at,
    'expiresAt', v_expires_at,
    'fingerprint', app_private.hrm_authorization_fingerprint(p_target_user_id),
    'effectivePermissions', v_effective_permissions,
    'history', v_history
  );
end;
$$;

create or replace function app_private.preview_user_hr_business_role_impl(
  p_target_user_id uuid,
  p_target_role_code text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := app_private.assert_hrm_role_admin();
  v_target_role_code text := upper(btrim(coalesce(p_target_role_code, '')));
  v_current_role_code text;
  v_target_template_id uuid;
  v_decision jsonb := jsonb_build_object('hardDenies', '[]'::jsonb, 'warnings', '[]'::jsonb);
  v_added jsonb := '[]'::jsonb;
  v_removed jsonb := '[]'::jsonb;
begin
  if v_target_role_code not in ('NONE', 'HR', 'HR_MANAGE') then
    raise exception 'Target HR role must be NONE, HR or HR_MANAGE'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.users target_row
    where target_row.id = p_target_user_id
      and target_row.is_active
      and target_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'HR role expiry must be in the future'
      using errcode = '22023';
  end if;

  select template.code into v_current_role_code
  from public.principal_role_assignments assignment_row
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id
   and template.code in ('HR', 'HR_MANAGE')
  where assignment_row.principal_type = 'user'
    and assignment_row.principal_id = p_target_user_id
    and assignment_row.status = 'ACTIVE'
    and assignment_row.starts_at <= now()
    and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  order by case template.code when 'HR_MANAGE' then 0 else 1 end
  limit 1;

  if v_actor_user_id = p_target_user_id and v_target_role_code = 'HR' then
    raise exception 'System Admin may self-assign only HR_MANAGE'
      using errcode = '42501';
  end if;

  if v_target_role_code <> 'NONE' then
    select template.id into v_target_template_id
    from public.role_permission_templates template
    where template.code = v_target_role_code
      and template.is_system
      and template.is_active;

    if v_target_template_id is null then
      raise exception 'Target HR role template is unavailable'
        using errcode = '23514';
    end if;
  end if;

  select coalesce(jsonb_agg(desired.permission_code order by desired.permission_code), '[]'::jsonb)
  into v_added
  from (
    select desired_item.permission_code
    from public.role_permission_template_items desired_item
    where desired_item.template_id = v_target_template_id
    except
    select current_item.permission_code
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates current_template
      on current_template.id = assignment_row.role_template_id
     and current_template.code in ('HR', 'HR_MANAGE')
    join public.role_permission_template_items current_item
      on current_item.template_id = current_template.id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  ) desired;

  select coalesce(jsonb_agg(current_permission.permission_code order by current_permission.permission_code), '[]'::jsonb)
  into v_removed
  from (
    select current_item.permission_code
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates current_template
      on current_template.id = assignment_row.role_template_id
     and current_template.code in ('HR', 'HR_MANAGE')
    join public.role_permission_template_items current_item
      on current_item.template_id = current_template.id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
    except
    select desired_item.permission_code
    from public.role_permission_template_items desired_item
    where desired_item.template_id = v_target_template_id
  ) current_permission;

  if v_target_role_code <> 'NONE' and v_target_role_code is distinct from v_current_role_code then
    if v_actor_user_id = p_target_user_id and v_target_role_code = 'HR_MANAGE' then
      v_decision := jsonb_build_object(
        'hardDenies', '[]'::jsonb,
        'warnings', jsonb_build_array(jsonb_build_object(
          'ruleCode', 'HRM_ADMIN_SELF_GRANT',
          'message', 'System Admin đang tự mở toàn bộ dữ liệu HR nhạy cảm.',
          'scopeType', 'global',
          'scopeId', '*'
        ))
      );
    else
      v_decision := app_private.evaluate_business_role_assignment_impl(
        v_actor_user_id,
        p_target_user_id,
        v_target_template_id,
        'global',
        '*'
      );
    end if;
  end if;

  return jsonb_build_object(
    'targetRoleCode', v_target_role_code,
    'currentRoleCode', v_current_role_code,
    'fingerprint', app_private.hrm_authorization_fingerprint(p_target_user_id),
    'added', v_added,
    'removed', v_removed,
    'warnings', coalesce(v_decision -> 'warnings', '[]'::jsonb),
    'hardDenies', coalesce(v_decision -> 'hardDenies', '[]'::jsonb),
    'opensC3', v_target_role_code in ('HR', 'HR_MANAGE'),
    'opensC4', v_target_role_code in ('HR', 'HR_MANAGE'),
    'allowsC4Mutation', v_target_role_code = 'HR_MANAGE',
    'allowsSensitiveExport', v_target_role_code = 'HR_MANAGE',
    'expiresAt', p_expires_at
  );
end;
$$;

create or replace function app_private.set_user_hr_business_role_impl(
  p_target_user_id uuid,
  p_target_role_code text,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb,
  p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := app_private.assert_hrm_role_admin();
  v_target_role_code text := upper(btrim(coalesce(p_target_role_code, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_preview jsonb;
  v_assignment record;
  v_target_template_id uuid;
  v_assignment_id uuid;
begin
  if char_length(v_reason) < 10 then
    raise exception 'HR role change reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  perform 1
  from public.users target_row
  where target_row.id = p_target_user_id
    and target_row.is_active
    and target_row.account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if app_private.hrm_authorization_fingerprint(p_target_user_id)
      is distinct from p_expected_fingerprint then
    raise exception 'HR authorization changed; reload preview before applying'
      using errcode = '40001';
  end if;

  v_preview := app_private.preview_user_hr_business_role_impl(
    p_target_user_id,
    v_target_role_code,
    p_expires_at
  );

  if jsonb_array_length(coalesce(v_preview -> 'hardDenies', '[]'::jsonb)) > 0 then
    raise exception 'HR role change violates a hard SoD rule'
      using errcode = '42501';
  end if;

  if v_actor_user_id = p_target_user_id
    and v_target_role_code = 'HR_MANAGE'
    and v_preview ->> 'currentRoleCode' is distinct from 'HR_MANAGE'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_warning_acceptances, '[]'::jsonb)) acceptance
      where acceptance ->> 'ruleCode' = 'HRM_ADMIN_SELF_GRANT'
        and coalesce((acceptance ->> 'accepted')::boolean, false)
    )
  then
    raise exception 'System Admin self-grant warning acceptance required'
      using errcode = '22023';
  end if;

  for v_assignment in
    select assignment_row.id
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template
      on template.id = assignment_row.role_template_id
     and template.code in ('HR', 'HR_MANAGE')
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
    order by assignment_row.created_at
  loop
    perform app_private.revoke_business_role_assignment_impl(v_assignment.id, v_reason);
  end loop;

  if v_target_role_code <> 'NONE' then
    select template.id into v_target_template_id
    from public.role_permission_templates template
    where template.code = v_target_role_code
      and template.is_system
      and template.is_active;

    if v_actor_user_id = p_target_user_id then
      if v_target_role_code <> 'HR_MANAGE' then
        raise exception 'System Admin may self-assign only HR_MANAGE'
          using errcode = '42501';
      end if;

      v_assignment_id := gen_random_uuid();
      insert into public.principal_role_assignments (
        id, principal_type, principal_id, role_template_id, scope_type, scope_id,
        starts_at, expires_at, status, assigned_by, assigned_reason
      ) values (
        v_assignment_id, 'user', p_target_user_id, v_target_template_id,
        'global', '*', now(), p_expires_at, 'ACTIVE', v_actor_user_id, v_reason
      );

      insert into public.permission_audit_events (
        actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
      ) values (
        v_actor_user_id,
        p_target_user_id,
        'hr_business_role_self_granted',
        coalesce(v_preview -> 'removed', '[]'::jsonb),
        coalesce(v_preview -> 'added', '[]'::jsonb),
        jsonb_build_object(
          'assignmentId', v_assignment_id,
          'roleCode', v_target_role_code,
          'reason', v_reason,
          'warningAcceptances', coalesce(p_warning_acceptances, '[]'::jsonb)
        )
      );
    else
      v_assignment_id := app_private.assign_business_role_impl(
        p_target_user_id,
        v_target_template_id,
        'global',
        '*',
        now(),
        p_expires_at,
        v_reason,
        coalesce(p_warning_acceptances, '[]'::jsonb)
      );
    end if;
  elsif v_actor_user_id = p_target_user_id then
    insert into public.permission_audit_events (
      actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
    ) values (
      v_actor_user_id,
      p_target_user_id,
      'hr_business_role_self_revoked',
      coalesce(v_preview -> 'removed', '[]'::jsonb),
      '[]'::jsonb,
      jsonb_build_object('reason', v_reason)
    );
  end if;

  return app_private.get_user_hr_authorization_impl(p_target_user_id);
end;
$$;

create or replace function public.get_user_hr_authorization(
  p_target_user_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.get_user_hr_authorization_impl(p_target_user_id);
$$;

create or replace function public.preview_user_hr_business_role(
  p_target_user_id uuid,
  p_target_role_code text,
  p_expires_at timestamptz default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.preview_user_hr_business_role_impl(
    p_target_user_id,
    p_target_role_code,
    p_expires_at
  );
$$;

create or replace function public.set_user_hr_business_role(
  p_target_user_id uuid,
  p_target_role_code text,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb,
  p_expected_fingerprint text
)
returns jsonb
language sql
set search_path = ''
as $$
  select app_private.set_user_hr_business_role_impl(
    p_target_user_id,
    p_target_role_code,
    p_expires_at,
    p_reason,
    p_warning_acceptances,
    p_expected_fingerprint
  );
$$;

revoke all on function app_private.assert_hrm_role_admin() from public, anon;
revoke all on function app_private.hrm_authorization_fingerprint(uuid) from public, anon, authenticated;
revoke all on function app_private.get_user_hr_authorization_impl(uuid) from public, anon;
revoke all on function app_private.preview_user_hr_business_role_impl(uuid, text, timestamptz) from public, anon;
revoke all on function app_private.set_user_hr_business_role_impl(uuid, text, timestamptz, text, jsonb, text) from public, anon;

grant execute on function app_private.get_user_hr_authorization_impl(uuid) to authenticated;
grant execute on function app_private.preview_user_hr_business_role_impl(uuid, text, timestamptz) to authenticated;
grant execute on function app_private.set_user_hr_business_role_impl(uuid, text, timestamptz, text, jsonb, text) to authenticated;

revoke all on function public.get_user_hr_authorization(uuid) from public, anon;
revoke all on function public.preview_user_hr_business_role(uuid, text, timestamptz) from public, anon;
revoke all on function public.set_user_hr_business_role(uuid, text, timestamptz, text, jsonb, text) from public, anon;

grant execute on function public.get_user_hr_authorization(uuid) to authenticated;
grant execute on function public.preview_user_hr_business_role(uuid, text, timestamptz) to authenticated;
grant execute on function public.set_user_hr_business_role(uuid, text, timestamptz, text, jsonb, text) to authenticated;

commit;
