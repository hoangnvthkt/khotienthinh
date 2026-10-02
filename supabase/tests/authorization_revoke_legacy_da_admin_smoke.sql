-- Run after authorization_revoke_legacy_da_admin. Rolls back.
begin;
do $$
begin
  if exists (select 1 from public.user_permission_grants where permission_code = 'system.da.manage' and is_active) then
    raise exception 'system.da.manage grants still active';
  end if;
  if (select direct_grant_allowed from public.permission_actions where permission_code = 'system.da.manage') then
    raise exception 'system.da.manage can still be granted';
  end if;
  if (select count(*) from app_private.da_admin_revocation_backup) < 39 then
    raise exception 'backup incomplete';
  end if;
  if exists (select 1 from app_private.da_admin_revocation_backup b
             where not exists (select 1 from public.user_permission_grants g where g.id = b.grant_id)) then
    raise exception 'backup points to a missing grant';
  end if;
  -- Saving a person who held it must still work: the grant is inactive, so it is not in their payload.
  if exists (select 1 from public.user_permission_grants g join app_private.da_admin_revocation_backup b on b.grant_id = g.id
             where g.is_active) then raise exception 'a backed-up grant is active'; end if;
end $$;
rollback;
