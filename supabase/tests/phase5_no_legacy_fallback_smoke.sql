-- Phase 5 feature-gated no-legacy-fallback smoke.
-- This does not enable the flag permanently; it verifies the future cutoff path transactionally.

begin;

do $$
begin
  if to_regprocedure('app_private.has_permission(uuid,text,text,text)') is null then
    raise exception 'Missing app_private.has_permission(uuid,text,text,text)';
  end if;

  if to_regprocedure('app_private.permission_hardening_flag(text)') is null then
    raise exception 'Missing app_private.permission_hardening_flag(text)';
  end if;
end $$;

create temp table phase5_no_fallback_smoke_ids (
  target_id uuid not null,
  target_email text not null
) on commit drop;

insert into phase5_no_fallback_smoke_ids
values (
  gen_random_uuid(),
  'phase5-no-fallback-target-smoke@vioo.local'
);

delete from public.user_permission_grants
where user_id in (select target_id from phase5_no_fallback_smoke_ids);

delete from public.users
where email in (select target_email from phase5_no_fallback_smoke_ids);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 5 No Fallback Target', target_email, 'phase5-no-fallback-target-smoke', 'EMPLOYEE', true, array['WMS']::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase5_no_fallback_smoke_ids;

update app_private.permission_hardening_settings
set value = 'false'::jsonb,
    updated_at = now()
where key = 'legacy_fallback_disabled';

do $$
declare
  v_target_id uuid := (select target_id from phase5_no_fallback_smoke_ids);
begin
  if not app_private.has_permission(v_target_id, 'system.wms.view', 'global', '*') then
    raise exception 'Legacy fallback should still work while legacy_fallback_disabled is false';
  end if;
end $$;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key = 'legacy_fallback_disabled';

do $$
declare
  v_target_id uuid := (select target_id from phase5_no_fallback_smoke_ids);
begin
  if app_private.has_permission(v_target_id, 'system.wms.view', 'global', '*') then
    raise exception 'Legacy fallback still grants access while legacy_fallback_disabled is true';
  end if;
end $$;

rollback;
