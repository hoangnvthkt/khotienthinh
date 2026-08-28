begin;

set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_summary jsonb;
  v_preview jsonb;
  v_applied jsonb;
  v_revoked jsonb;
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

  if v_admin.id is null then
    raise exception 'HRM_SELF_GRANT_ADMIN_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin.auth_id, 'email', v_admin.email)::text,
    true
  );

  v_summary := public.get_user_hr_authorization(v_admin.id);
  v_preview := public.preview_user_hr_business_role(v_admin.id, 'HR_MANAGE', null);

  if v_preview ->> 'fingerprint' is distinct from v_summary ->> 'fingerprint'
    or not coalesce((v_preview ->> 'opensC4')::boolean, false)
    or not exists (
      select 1
      from jsonb_array_elements(v_preview -> 'warnings') warning
      where warning ->> 'ruleCode' = 'HRM_ADMIN_SELF_GRANT'
    )
  then
    raise exception 'HRM_SELF_GRANT_PREVIEW_INVALID: %', v_preview;
  end if;

  v_applied := public.set_user_hr_business_role(
    v_admin.id,
    'HR_MANAGE',
    null,
    'Smoke: System Admin tự cấp HR Manage',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );

  if v_applied ->> 'hrRole' is distinct from 'HR_MANAGE'
    or not exists (
      select 1
      from public.permission_audit_events event_row
      where event_row.actor_user_id = v_admin.id
        and event_row.target_user_id = v_admin.id
        and event_row.event_type = 'hr_business_role_self_granted'
    )
  then
    raise exception 'HRM_SELF_GRANT_APPLY_INVALID: %', v_applied;
  end if;

  v_revoked := public.set_user_hr_business_role(
    v_admin.id,
    'NONE',
    null,
    'Smoke: System Admin thu hồi HR Manage',
    '[]'::jsonb,
    v_applied ->> 'fingerprint'
  );

  if v_revoked -> 'hrRole' <> 'null'::jsonb then
    raise exception 'HRM_SELF_GRANT_REVOKE_INVALID: %', v_revoked;
  end if;
end;
$$;

rollback;
