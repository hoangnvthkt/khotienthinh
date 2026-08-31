begin;
set local statement_timeout = '30s';

select set_config(
  'request.jwt.claim.sub',
  (
    select user_row.auth_id::text
    from public.users user_row
    join public.principal_role_assignments assignment_row
      on assignment_row.principal_type = 'user'
     and assignment_row.principal_id = user_row.id
     and assignment_row.status = 'ACTIVE'
     and assignment_row.starts_at <= now()
     and (assignment_row.expires_at is null or assignment_row.expires_at > now())
    join public.role_permission_templates template_row
      on template_row.id = assignment_row.role_template_id
     and template_row.code = 'SYSTEM_ADMIN'
    where user_row.role = 'ADMIN'
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
    order by user_row.created_at
    limit 1
  ),
  true
);

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'role', 'authenticated',
      'sub', user_row.auth_id,
      'email', user_row.email
    )::text
    from public.users user_row
    where user_row.auth_id = current_setting('request.jwt.claim.sub')::uuid
  ),
  true
);

set local role authenticated;

do $$
declare
  v_source_count integer;
begin
  select count(*) into v_source_count
  from public.get_effective_permission_sources();

  if v_source_count = 0 then
    raise exception 'AUTH_EFFECTIVE_PERMISSION_SOURCES_EMPTY';
  end if;
end;
$$;

reset role;
rollback;
