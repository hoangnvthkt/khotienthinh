-- Smoke for 20261009200000_revoke_dead_system_grants. Read-only.
do $$
declare v_codes constant text[] := array[
  'system.wf.view', 'system.wf.manage', 'system.ts.view', 'system.ts.manage', 'system.ex.view', 'system.ex.manage',
  'system.hd.view', 'system.rq.manage', 'system.kb.view', 'system.kb.manage', 'system.ai.view', 'system.ai.manage',
  'system.storage.view', 'system.storage.manage', 'system.analytics.view', 'system.analytics.manage'];
begin
  if exists (select 1 from public.user_permission_grants where is_active and permission_code = any(v_codes)) then
    raise exception 'a revoked dead system grant is active again';
  end if;
  if exists (
    select 1 from app_private.revoked_dead_system_grants_20261009 snap
    join public.user_permission_grants g on g.id = snap.id
    where g.revoked_at is null or g.revoked_reason is null
  ) then
    raise exception 'revoked rows lost their revocation record';
  end if;
  if (select count(*) from app_private.revoked_dead_system_grants_20261009) = 0 then
    raise exception 'backup is empty';
  end if;
  if has_table_privilege('authenticated', 'app_private.revoked_dead_system_grants_20261009', 'select') then
    raise exception 'authenticated can read the backup';
  end if;
  -- Kept codes are untouched.
  if not exists (select 1 from public.user_permission_grants where is_active and permission_code = 'system.chat.view') then
    raise exception 'kept grants were revoked';
  end if;
end $$;
