begin;
set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_summary jsonb;
  v_readiness jsonb;
  v_blocked boolean := false;
begin
  select user_row.* into v_admin
  from public.users user_row
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user'
   and assignment_row.principal_id = user_row.id
   and assignment_row.status = 'ACTIVE'
   and assignment_row.starts_at <= now()
   and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id
   and template.code = 'SYSTEM_ADMIN'
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
  order by user_row.created_at
  limit 1;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin.auth_id, 'email', v_admin.email)::text,
    true
  );

  begin
    perform public.get_hrm_manager_scope_readiness();
  exception when others then
    v_blocked := position('HRM_STAFFING_VIEW_REQUIRED' in sqlerrm) > 0;
  end;
  if not v_blocked then
    raise exception 'HRM_MANAGER_SCOPE_TECHNICAL_ADMIN_NOT_BLOCKED';
  end if;

  v_summary := public.get_user_hr_authorization(v_admin.id);
  perform public.set_user_hr_business_role(
    v_admin.id, 'HR_MANAGE', null,
    'Smoke: tự cấp HR Manage kiểm thử readiness',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );

  v_readiness := public.get_hrm_manager_scope_readiness();
  if coalesce((v_readiness ->> 'isReady')::boolean, true)
    or coalesce((v_readiness ->> 'isEnabled')::boolean, true)
    or coalesce((v_readiness ->> 'missingPrimaryCount')::integer, 0) = 0
  then
    raise exception 'HRM_MANAGER_SCOPE_EXPECTED_CLOSED_GATE: %', v_readiness;
  end if;

  v_blocked := false;
  begin
    perform public.set_hrm_manager_scope_enabled(
      true,
      'Smoke: không được bật khi dữ liệu chưa đạt readiness'
    );
  exception when others then
    v_blocked := position('HRM_MANAGER_SCOPE_NOT_READY' in sqlerrm) > 0;
  end;
  if not v_blocked then
    raise exception 'HRM_MANAGER_SCOPE_NOT_READY_GATE_FAILED';
  end if;

  if app_private.resolve_strict_direct_manager(v_admin.id) is not null then
    raise exception 'HRM_MANAGER_SCOPE_STRICT_RESOLVER_BYPASSED_GATE';
  end if;
end;
$$;

rollback;
