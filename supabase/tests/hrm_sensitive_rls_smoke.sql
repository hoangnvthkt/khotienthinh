begin;

set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
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
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := public.current_app_user_id();
  v_summary jsonb;
  v_applied jsonb;
  v_without_role integer;
  v_with_role integer;
begin
  v_summary := public.get_user_hr_authorization(v_admin_id);
  if v_summary ->> 'hrRole' is not null then
    v_summary := public.set_user_hr_business_role(
      v_admin_id, 'NONE', null,
      'Smoke: remove pre-existing HR role',
      '[]'::jsonb,
      v_summary ->> 'fingerprint'
    );
  end if;

  select count(*)::integer into v_without_role from public.hrm_documents;
  if v_without_role <> 0 then
    raise exception 'TECHNICAL_ADMIN_READS_HR_DOCUMENTS_WITHOUT_ROLE: %', v_without_role;
  end if;

  v_applied := public.set_user_hr_business_role(
    v_admin_id, 'HR_MANAGE', null,
    'Smoke: enable HR Manage for RLS test',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );

  select count(*)::integer into v_with_role from public.hrm_documents;
  if v_with_role = 0 then
    raise exception 'HR_MANAGE_CANNOT_READ_HR_DOCUMENTS';
  end if;

  perform public.set_user_hr_business_role(
    v_admin_id, 'NONE', null,
    'Smoke: revoke HR Manage after RLS test',
    '[]'::jsonb,
    v_applied ->> 'fingerprint'
  );
end;
$$;

reset role;

rollback;
