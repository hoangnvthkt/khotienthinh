-- Phase 5 legacy projection and audit smoke.
-- Run transactionally after the Phase 5 hardening prep migration.

begin;

do $$
begin
  if to_regprocedure('app_private.sync_legacy_permission_projection(uuid)') is null then
    raise exception 'Missing app_private.sync_legacy_permission_projection(uuid)';
  end if;

  if to_regprocedure('public.replace_user_permission_grants(uuid,jsonb)') is null then
    raise exception 'Missing public.replace_user_permission_grants(uuid,jsonb)';
  end if;
end $$;

create temp table phase5_audit_smoke_ids (
  admin_id uuid not null,
  target_id uuid not null,
  admin_email text not null,
  target_email text not null
) on commit drop;

grant select, insert, update, delete on table phase5_audit_smoke_ids to authenticated;

insert into phase5_audit_smoke_ids
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'phase5-audit-admin-smoke@vioo.local',
  'phase5-audit-target-smoke@vioo.local'
);

delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase5_audit_smoke_ids)
   or target_user_id in (select target_id from phase5_audit_smoke_ids);

delete from public.user_permission_grants
where user_id in (select target_id from phase5_audit_smoke_ids);

delete from public.users
where email in (
  select admin_email from phase5_audit_smoke_ids
  union all
  select target_email from phase5_audit_smoke_ids
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Phase 5 Audit Admin', admin_email, 'phase5-audit-admin-smoke', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase5_audit_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 5 Audit Target', target_email, 'phase5-audit-target-smoke', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase5_audit_smoke_ids;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key = 'legacy_projection_enabled';

set role authenticated;

select set_config('request.jwt.claim.email', (select admin_email from phase5_audit_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select admin_email from phase5_audit_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

select public.replace_user_permission_grants(
  (select target_id from phase5_audit_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'system.wms.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true
  ))
);

reset role;

do $$
declare
  v_target_id uuid := (select target_id from phase5_audit_smoke_ids);
begin
  if not exists (
    select 1
    from public.users u
    where u.id = v_target_id
      and 'WMS' = any(coalesce(u.allowed_modules, '{}'::text[]))
  ) then
    raise exception 'Legacy projection did not sync allowed_modules from namespace grants';
  end if;

  if not exists (
    select 1
    from public.permission_audit_events pae
    where pae.target_user_id = v_target_id
      and pae.event_type = 'legacy_projection_synced'
  ) then
    raise exception 'Legacy projection sync did not write audit event';
  end if;
end $$;

rollback;
