begin;

do $$
declare
  v_active_retired_setting text := current_setting('app.expected_active_retired_count', true);
  v_active_sensitive_setting text := current_setting('app.expected_active_sensitive_count', true);
  v_non_sensitive_fingerprint text := current_setting('app.expected_non_sensitive_fingerprint', true);
  v_active_direct_grant_setting text := current_setting('app.expected_active_direct_grant_count', true);
  v_retirement_audit_setting text := current_setting('app.expected_retirement_audit_count', true);
  v_durable_operator_setting text := current_setting('app.expected_durable_operator_count', true);
  v_active_retired_count bigint;
  v_active_sensitive_count bigint;
  v_actual_non_sensitive_fingerprint text;
  v_active_direct_grant_count bigint;
  v_retirement_audit_count bigint;
  v_durable_operator_count bigint;
  v_enabled_flag_count bigint;
begin
  if coalesce(v_active_retired_setting, '') = ''
    or coalesce(v_active_sensitive_setting, '') = ''
    or coalesce(v_non_sensitive_fingerprint, '') = ''
    or coalesce(v_active_direct_grant_setting, '') = ''
    or coalesce(v_retirement_audit_setting, '') = ''
    or coalesce(v_durable_operator_setting, '') = '' then
    raise exception 'Missing retirement postcheck settings';
  end if;

  select count(*) into v_active_retired_count
  from public.user_permission_grants
  where is_active and permission_code in (
    'project.material_request.confirm',
    'project.material_request.verify'
  );

  select count(*) into v_active_sensitive_count
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code and action_row.is_active
  where grant_row.is_active and action_row.risk_level = 'sensitive';

  select md5(coalesce(string_agg(concat_ws('|', grant_row.user_id::text,
    grant_row.permission_code, grant_row.scope_type, grant_row.scope_id,
    coalesce(to_char(grant_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
    E'\n' order by grant_row.user_id, grant_row.permission_code, grant_row.scope_type, grant_row.scope_id), ''))
  into v_actual_non_sensitive_fingerprint
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code and action_row.is_active
  where grant_row.is_active and action_row.risk_level <> 'sensitive';

  select count(*) into v_active_direct_grant_count
  from public.user_permission_grants where is_active;

  select count(*) into v_retirement_audit_count
  from public.permission_audit_events
  where event_type = 'direct_permission_grants_changed'
    and metadata ->> 'reason' = 'Task 13 Step 5: thu hồi quyền Material Request đã retire';

  select count(distinct user_row.id) into v_durable_operator_count
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user' and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE' and assignment_row.starts_at <= now()
   and assignment_row.expires_at is null and assignment_row.scope_type = 'global' and assignment_row.scope_id = '*'
  join public.role_permission_templates template_row
    on template_row.id = assignment_row.role_template_id and template_row.is_active
  join public.role_permission_template_items item_row
    on item_row.template_id = template_row.id and item_row.permission_code = 'system.authorization.manage_roles'
   and item_row.scope_type = 'global' and item_row.scope_id = '*'
  where user_row.role = 'ADMIN' and user_row.is_active and user_row.account_status = 'ACTIVE';

  select count(*) into v_enabled_flag_count
  from app_private.permission_hardening_settings where value = 'true'::jsonb;

  if v_active_retired_count <> v_active_retired_setting::bigint
    or v_active_sensitive_count <> v_active_sensitive_setting::bigint
    or v_actual_non_sensitive_fingerprint <> v_non_sensitive_fingerprint
    or v_active_direct_grant_count <> v_active_direct_grant_setting::bigint
    or v_retirement_audit_count <> v_retirement_audit_setting::bigint
    or v_durable_operator_count <> v_durable_operator_setting::bigint
    or v_enabled_flag_count <> 0 then
    raise exception 'Retirement postcheck baseline mismatch';
  end if;
end;
$$;

select 'authorization_sensitive_grant_retirement_postcheck_passed' as checkpoint;

rollback;
