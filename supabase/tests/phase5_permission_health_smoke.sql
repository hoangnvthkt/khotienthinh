-- Phase 5 permission health RPC smoke.
-- Run transactionally after the Phase 5 hardening prep migration.

begin;

do $$
begin
  if to_regclass('app_private.permission_hardening_settings') is null then
    raise exception 'Missing app_private.permission_hardening_settings';
  end if;

  if to_regprocedure('app_private.permission_hardening_flag(text)') is null then
    raise exception 'Missing app_private.permission_hardening_flag(text)';
  end if;

  if to_regprocedure('public.get_permission_health_summary()') is null then
    raise exception 'Missing public.get_permission_health_summary()';
  end if;
end $$;

create temp table phase5_health_smoke_ids (
  admin_id uuid not null,
  admin_email text not null
) on commit drop;

grant select, insert, update, delete on table phase5_health_smoke_ids to authenticated;

insert into phase5_health_smoke_ids
values (
  gen_random_uuid(),
  'phase5-health-admin-smoke@vioo.local'
);

delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase5_health_smoke_ids);

delete from public.users
where email in (select admin_email from phase5_health_smoke_ids);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Phase 5 Health Admin', admin_email, 'phase5-health-admin-smoke', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase5_health_smoke_ids;

set role authenticated;

select set_config('request.jwt.claim.email', (select admin_email from phase5_health_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select admin_email from phase5_health_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
declare
  v_summary jsonb;
begin
  v_summary := public.get_permission_health_summary();

  if jsonb_typeof(v_summary) <> 'object' then
    raise exception 'Permission health summary is not a JSON object: %', v_summary;
  end if;

  if not (v_summary ? 'generatedAt') then
    raise exception 'Permission health summary is missing generatedAt';
  end if;

  if not (v_summary ? 'status') then
    raise exception 'Permission health summary is missing status';
  end if;

  if not (v_summary ? 'checks') then
    raise exception 'Permission health summary is missing checks';
  end if;

  if not ((v_summary->'checks') ? 'broadPolicies') then
    raise exception 'Permission health summary is missing broadPolicies check';
  end if;

  if not ((v_summary->'checks') ? 'legacyAdminFunctionConsumers') then
    raise exception 'Permission health summary is missing legacyAdminFunctionConsumers check';
  end if;
end $$;

reset role;

rollback;
