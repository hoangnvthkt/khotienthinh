begin;

set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_blocked boolean := false;
  v_health jsonb;
begin
  select * into v_admin
  from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE'
  order by created_at
  limit 1;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin.auth_id, 'email', v_admin.email)::text,
    true
  );

  begin
    insert into public.user_permission_grants (
      user_id, permission_code, scope_type, scope_id, is_active,
      granted_by, granted_at, grant_reason
    ) values (
      v_admin.id, 'hrm.employee.view_sensitive', 'global', '*', true,
      v_admin.id, now(), 'Smoke: direct sensitive grant must fail'
    )
    on conflict (user_id, permission_code, scope_type, scope_id) do update
    set is_active = true,
        updated_at = now();
  exception when others then
    v_blocked := sqlstate = '42501'
      and position('HRM_TEMPLATE_ONLY_PERMISSION' in sqlerrm) > 0;
  end;

  if not v_blocked then
    raise exception 'HRM_DIRECT_SENSITIVE_GRANT_NOT_BLOCKED';
  end if;

  v_health := public.get_permission_health_summary();
  if not (v_health -> 'checks' ? 'anonSensitiveSelect')
    or not (v_health -> 'checks' ? 'hrmSensitiveBroadRead')
    or not (v_health -> 'checks' ? 'hrmRawTableExposure')
    or not (v_health -> 'checks' ? 'hrmLegacyAdminPolicies')
    or not (v_health -> 'checks' ? 'hrSensitiveGrantOutsideApprovedTemplate')
    or not (v_health -> 'checks' ? 'hrAdminImplicitBypass')
    or not (v_health -> 'checks' ? 'hrTemplateDefinitionDrift')
    or not (v_health -> 'checks' ? 'hrmManagerReadiness')
  then
    raise exception 'HRM_PERMISSION_HEALTH_CHECKS_MISSING: %', v_health -> 'checks';
  end if;
end;
$$;

rollback;
