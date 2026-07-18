begin;

do $$
declare
  v_expected_non_sensitive_fingerprint text :=
    current_setting('app.expected_non_sensitive_fingerprint', true);
  v_expected_regrant_count bigint;
  v_expected_regrant_fingerprint text :=
    current_setting('app.expected_regrant_fingerprint', true);
  v_expected_regrant_expires_at timestamptz;
  v_sensitive_count bigint;
  v_sensitive_fingerprint text;
  v_invalid_sensitive_count bigint;
  v_non_sensitive_fingerprint text;
  v_flag_count bigint;
  v_false_flag_count bigint;
  v_operator_count bigint;
begin
  if coalesce(current_setting('app.expected_regrant_count', true), '') = ''
    or coalesce(v_expected_regrant_fingerprint, '') = ''
    or coalesce(current_setting('app.expected_regrant_expires_at', true), '') = ''
    or coalesce(v_expected_non_sensitive_fingerprint, '') = ''
  then
    raise exception 'Missing expected final-gate session settings';
  end if;

  v_expected_regrant_count :=
    current_setting('app.expected_regrant_count')::bigint;
  v_expected_regrant_expires_at :=
    current_setting('app.expected_regrant_expires_at')::timestamptz;

  select
    count(*),
    md5(coalesce(string_agg(
      concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
        grant_row.scope_type, grant_row.scope_id),
      E'\n' order by grant_row.user_id, grant_row.permission_code,
        grant_row.scope_type, grant_row.scope_id
    ), '')),
    count(*) filter (
      where grant_row.expires_at is distinct from v_expected_regrant_expires_at
         or grant_row.grant_reason is distinct from
           'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt'
    )
  into v_sensitive_count, v_sensitive_fingerprint, v_invalid_sensitive_count
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level = 'sensitive';

  if v_sensitive_count <> v_expected_regrant_count
    or v_sensitive_fingerprint <> v_expected_regrant_fingerprint
  then
    raise exception 'Active sensitive direct grants do not match approved manifest';
  end if;

  if v_invalid_sensitive_count <> 0 then
    raise exception 'Active sensitive direct grants require exact expiry and reason';
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US'), '')),
    E'\n' order by grant_row.user_id, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id
  ), ''))
  into v_non_sensitive_fingerprint
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level <> 'sensitive';

  if v_non_sensitive_fingerprint <> v_expected_non_sensitive_fingerprint then
    raise exception 'Non-sensitive direct-grant fingerprint changed';
  end if;

  select
    count(*),
    count(*) filter (where setting_row.value = 'false'::jsonb)
  into v_flag_count, v_false_flag_count
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  if v_flag_count <> 3 or v_false_flag_count <> 3 then
    raise exception 'Authorization rollout flags must all remain false';
  end if;

  select count(distinct user_row.id)
  into v_operator_count
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and assignment_row.expires_at is null
   and assignment_row.scope_type = 'global'
   and assignment_row.scope_id = '*'
  join public.role_permission_templates role_row
    on role_row.id = assignment_row.role_template_id
   and role_row.is_active
  join public.role_permission_template_items item
    on item.template_id = role_row.id
   and item.permission_code = 'system.authorization.manage_roles'
   and item.scope_type = 'global'
   and item.scope_id = '*'
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_operator_count < 1 then
    raise exception 'At least one durable rollout operator is required';
  end if;
end;
$$;

select 'authorization_sensitive_grant_regrant_gate_passed' as checkpoint;

rollback;
