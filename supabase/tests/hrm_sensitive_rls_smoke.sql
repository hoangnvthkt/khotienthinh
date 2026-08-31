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
  v_documents jsonb;
  v_blocked boolean;
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

  v_blocked := false;
  begin perform public.list_hrm_documents(null,null,null,null,10);
  exception when others then v_blocked := position('HRM_DOCUMENT_VIEW_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'TECHNICAL_ADMIN_PROJECTION_NOT_BLOCKED'; end if;
  v_blocked := false;
  begin perform count(*) from public.hrm_documents;
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'TECHNICAL_ADMIN_RAW_DOCUMENT_READ_NOT_BLOCKED'; end if;

  v_applied := public.set_user_hr_business_role(
    v_admin_id, 'HR_MANAGE', null,
    'Smoke: enable HR Manage for RLS test',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );

  v_documents := public.list_hrm_documents(null,null,null,null,10);
  if jsonb_typeof(v_documents) <> 'array' then raise exception 'HR_MANAGE_DOCUMENT_PROJECTION_INVALID'; end if;
  v_blocked := false;
  begin perform count(*) from public.hrm_documents;
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'HR_MANAGE_RAW_DOCUMENT_READ_NOT_BLOCKED'; end if;

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
