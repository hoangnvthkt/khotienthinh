begin;

do $$
declare
  v_original_source_count_setting text := current_setting('app.expected_original_source_count', true);
  v_original_source_fingerprint text := current_setting('app.expected_original_source_fingerprint', true);
  v_original_regrant_count_setting text := current_setting('app.expected_original_regrant_count', true);
  v_original_regrant_fingerprint text := current_setting('app.expected_original_regrant_fingerprint', true);
  v_revised_regrant_count_setting text := current_setting('app.expected_revised_regrant_count', true);
  v_revised_regrant_fingerprint text := current_setting('app.expected_revised_regrant_fingerprint', true);
  v_non_sensitive_fingerprint text := current_setting('app.expected_non_sensitive_fingerprint', true);
  v_active_direct_grant_count_setting text := current_setting('app.expected_active_direct_grant_count', true);
  v_durable_operator_count_setting text := current_setting('app.expected_durable_operator_count', true);
  v_regrant_expires_at_setting text := current_setting('app.expected_regrant_expires_at', true);
  v_expected_original_source_count bigint;
  v_expected_original_regrant_count bigint;
  v_expected_revised_regrant_count bigint;
  v_expected_active_direct_grant_count bigint;
  v_expected_durable_operator_count bigint;
  v_expected_regrant_expires_at timestamptz;
  v_original_source_count bigint;
  v_actual_original_source_fingerprint text;
  v_original_regrant_count bigint;
  v_actual_original_regrant_fingerprint text;
  v_revised_regrant_count bigint;
  v_actual_revised_regrant_fingerprint text;
  v_active_retired_count bigint;
  v_active_contract_invalid_count bigint;
  v_actual_non_sensitive_fingerprint text;
  v_active_direct_grant_count bigint;
  v_durable_operator_count bigint;
  v_enabled_hardening_flag_count bigint;
begin
  if coalesce(v_original_source_count_setting, '') = ''
    or coalesce(v_original_source_fingerprint, '') = ''
    or coalesce(v_original_regrant_count_setting, '') = ''
    or coalesce(v_original_regrant_fingerprint, '') = ''
    or coalesce(v_revised_regrant_count_setting, '') = ''
    or coalesce(v_revised_regrant_fingerprint, '') = ''
    or coalesce(v_non_sensitive_fingerprint, '') = ''
    or coalesce(v_active_direct_grant_count_setting, '') = ''
    or coalesce(v_durable_operator_count_setting, '') = ''
    or coalesce(v_regrant_expires_at_setting, '') = '' then
    raise exception 'Missing manifest revision gate settings';
  end if;

  v_expected_original_source_count := v_original_source_count_setting::bigint;
  v_expected_original_regrant_count := v_original_regrant_count_setting::bigint;
  v_expected_revised_regrant_count := v_revised_regrant_count_setting::bigint;
  v_expected_active_direct_grant_count := v_active_direct_grant_count_setting::bigint;
  v_expected_durable_operator_count := v_durable_operator_count_setting::bigint;
  v_expected_regrant_expires_at := v_regrant_expires_at_setting::timestamptz;

  with source_rows as (
    select
      grant_row.user_id,
      grant_row.permission_code,
      grant_row.scope_type,
      grant_row.scope_id,
      grant_row.is_active,
      grant_row.expires_at,
      grant_row.grant_reason
    from public.user_permission_grants grant_row
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where action_row.risk_level = 'sensitive'
      and (
        (
          not grant_row.is_active
          and grant_row.revoked_reason =
            'Task 13 Step 5: thu hồi toàn bộ quyền nhạy cảm trước tái cấp'
        )
        or (
          grant_row.is_active
          and grant_row.grant_reason =
            'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt'
        )
      )
  ), original_regrant as (
    select source_row.*
    from source_rows source_row
    where not exists (
      select 1
      from public.principal_role_assignments assignment_row
      join public.role_permission_templates template_row
        on template_row.id = assignment_row.role_template_id
      where assignment_row.principal_type = 'user'
        and assignment_row.principal_id = source_row.user_id
        and assignment_row.status = 'ACTIVE'
        and assignment_row.starts_at <= now()
        and (assignment_row.expires_at is null or assignment_row.expires_at > now())
        and assignment_row.scope_type = 'global'
        and assignment_row.scope_id = '*'
        and template_row.code = 'PERMISSION_ADMIN'
        and template_row.is_active
    )
  ), revised_regrant as (
    select *
    from original_regrant
    where permission_code not in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )
  )
  select
    (select count(*) from source_rows),
    (select md5(coalesce(string_agg(
      concat_ws('|', user_id::text, permission_code, scope_type, scope_id),
      E'\n' order by user_id, permission_code, scope_type, scope_id
    ), '')) from source_rows),
    (select count(*) from original_regrant),
    (select md5(coalesce(string_agg(
      concat_ws('|', user_id::text, permission_code, scope_type, scope_id),
      E'\n' order by user_id, permission_code, scope_type, scope_id
    ), '')) from original_regrant),
    (select count(*) from revised_regrant),
    (select md5(coalesce(string_agg(
      concat_ws('|', user_id::text, permission_code, scope_type, scope_id),
      E'\n' order by user_id, permission_code, scope_type, scope_id
    ), '')) from revised_regrant),
    (select count(*) from source_rows where is_active and permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )),
    (select count(*) from revised_regrant where is_active and (
      expires_at is distinct from v_expected_regrant_expires_at
      or grant_reason is distinct from
        'Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt'
    ))
  into
    v_original_source_count,
    v_actual_original_source_fingerprint,
    v_original_regrant_count,
    v_actual_original_regrant_fingerprint,
    v_revised_regrant_count,
    v_actual_revised_regrant_fingerprint,
    v_active_retired_count,
    v_active_contract_invalid_count;

  if v_original_source_count <> v_expected_original_source_count
    or v_actual_original_source_fingerprint <> v_original_source_fingerprint
    or v_original_regrant_count <> v_expected_original_regrant_count
    or v_actual_original_regrant_fingerprint <> v_original_regrant_fingerprint then
    raise exception 'Frozen manifest baseline does not match';
  end if;

  if v_revised_regrant_count <> v_expected_revised_regrant_count
    or v_actual_revised_regrant_fingerprint <> v_revised_regrant_fingerprint then
    raise exception 'Revised manifest does not match approved runtime values';
  end if;

  if v_active_retired_count <> 0 then
    raise exception 'Retired sensitive keys require governed remediation';
  end if;

  if v_active_contract_invalid_count <> 0 then
    raise exception 'Active revised keys require canonical expiry and reason';
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', grant_row.user_id::text, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id,
      coalesce(to_char(grant_row.expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US'), '')
    ),
    E'\n' order by grant_row.user_id, grant_row.permission_code,
      grant_row.scope_type, grant_row.scope_id
  ), ''))
  into v_actual_non_sensitive_fingerprint
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level <> 'sensitive';

  if v_actual_non_sensitive_fingerprint <> v_non_sensitive_fingerprint then
    raise exception 'Non-sensitive direct-grant fingerprint changed';
  end if;

  select count(*)
  into v_active_direct_grant_count
  from public.user_permission_grants
  where is_active;

  if v_active_direct_grant_count <> v_expected_active_direct_grant_count then
    raise exception 'Active Direct Grant count changed';
  end if;

  select count(distinct user_row.id)
  into v_durable_operator_count
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and assignment_row.expires_at is null
   and assignment_row.scope_type = 'global'
   and assignment_row.scope_id = '*'
  join public.role_permission_templates template_row
    on template_row.id = assignment_row.role_template_id
   and template_row.is_active
  join public.role_permission_template_items item_row
    on item_row.template_id = template_row.id
   and item_row.permission_code = 'system.authorization.manage_roles'
   and item_row.scope_type = 'global'
   and item_row.scope_id = '*'
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_durable_operator_count <> v_expected_durable_operator_count then
    raise exception 'Durable rollout operator count changed';
  end if;

  select count(*)
  into v_enabled_hardening_flag_count
  from app_private.permission_hardening_settings
  where value = 'true'::jsonb;

  if v_enabled_hardening_flag_count <> 0 then
    raise exception 'Authorization rollout flags must remain disabled';
  end if;
end;
$$;

select 'authorization_sensitive_grant_manifest_revision_gate_passed' as checkpoint;

rollback;
