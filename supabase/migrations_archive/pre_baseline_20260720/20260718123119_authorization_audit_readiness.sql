update public.permission_actions
set grant_readiness = 'verified',
    updated_at = now()
where permission_code in (
    'system.authorization.view',
    'system.authorization.audit'
  )
  and grant_readiness = 'declared'
  and is_active;

do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
        'system.authorization.view',
        'system.authorization.audit'
      )
      and grant_readiness = 'verified'
      and scope_modes = array['global']::text[]
      and not direct_grant_requires_expiry
  ) <> 2 then
    raise exception 'authorization View+Audit readiness promotion failed';
  end if;
end;
$$;
