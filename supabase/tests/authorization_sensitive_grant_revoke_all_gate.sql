begin;

do $$
declare
  v_expected_non_sensitive_fingerprint text :=
    current_setting('app.expected_non_sensitive_fingerprint', true);
  v_active_sensitive_count bigint;
  v_non_sensitive_fingerprint text;
  v_flag_count bigint;
  v_false_flag_count bigint;
begin
  if coalesce(v_expected_non_sensitive_fingerprint, '') = '' then
    raise exception 'Missing app.expected_non_sensitive_fingerprint';
  end if;

  select count(*)
  into v_active_sensitive_count
  from public.user_permission_grants grant_row
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
   and action_row.is_active
  where grant_row.is_active
    and action_row.risk_level = 'sensitive';

  if v_active_sensitive_count <> 0 then
    raise exception 'Expected zero active sensitive direct grants, found %',
      v_active_sensitive_count;
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
end;
$$;

select 'authorization_sensitive_grant_revoke_all_gate_passed' as checkpoint;

rollback;
