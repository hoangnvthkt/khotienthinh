begin;

update public.user_permission_grants
set is_active = false,
    revoked_at = coalesce(revoked_at, now()),
    revoked_reason = coalesce(revoked_reason, 'HRM governed permission cutover'),
    updated_at = now()
where permission_code in ('system.hrm.view', 'system.hrm.manage')
  and coalesce(is_active, true);

update public.permission_actions
set is_active = false,
    grant_readiness = 'legacy',
    updated_at = now()
where permission_code in ('system.hrm.view', 'system.hrm.manage')
  and is_active;

do $$
begin
  if exists (
    select 1
    from public.permission_actions
    where permission_code in ('system.hrm.view', 'system.hrm.manage')
      and is_active
  ) then
    raise exception using errcode = '55000', message = 'HRM_MODULE_ALIAS_DEACTIVATION_FAILED';
  end if;

  if exists (
    select 1
    from public.user_permission_grants
    where permission_code in ('system.hrm.view', 'system.hrm.manage')
      and coalesce(is_active, true)
  ) then
    raise exception using errcode = '55000', message = 'HRM_MODULE_ALIAS_GRANT_REVOCATION_FAILED';
  end if;
end;
$$;

commit;
