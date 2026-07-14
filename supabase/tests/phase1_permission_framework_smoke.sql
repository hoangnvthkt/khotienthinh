-- Phase 1 permission framework smoke checks.
-- Safe to run after the Phase 1 migration; test rows are cleaned up at the end.

do $$
declare
  new_tables text[] := array[
    'permission_applications',
    'permission_modules',
    'permission_actions',
    'user_permission_grants',
    'role_permission_templates',
    'role_permission_template_items',
    'permission_audit_events'
  ];
  tbl text;
begin
  foreach tbl in array new_tables loop
    if to_regclass(format('public.%I', tbl)) is null then
      raise exception 'Missing permission framework table: %', tbl;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tbl
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', tbl;
    end if;

    if exists (
      select 1
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = tbl
        and g.grantee = 'anon'
        and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception 'anon still has privileges on public.%', tbl;
    end if;
  end loop;

  if to_regprocedure('app_private.has_permission(uuid,text,text,text)') is null then
    raise exception 'Missing app_private.has_permission(uuid,text,text,text)';
  end if;

  if to_regprocedure('app_private.has_any_permission(uuid,text[],text,text)') is null then
    raise exception 'Missing app_private.has_any_permission(uuid,text[],text,text)';
  end if;

  if to_regprocedure('app_private.can_manage_permissions()') is null then
    raise exception 'Missing app_private.can_manage_permissions()';
  end if;

  if to_regprocedure('public.replace_user_permission_grants(uuid,jsonb)') is null then
    raise exception 'Missing public.replace_user_permission_grants(uuid,jsonb)';
  end if;

  if not exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'system.wms.view',
      'system.settings.manage',
      'project.daily_log.approve',
      'project.material_request.view_available_stock',
      'project.quality.manage'
    )
  ) then
    raise exception 'Required seed permission actions are missing';
  end if;
end $$;

create temp table if not exists phase1_permission_smoke_ids (
  admin_id uuid not null,
  target_id uuid not null,
  admin_email text not null,
  target_email text not null
) on commit drop;

truncate table phase1_permission_smoke_ids;
grant select, insert, update, delete on table phase1_permission_smoke_ids to authenticated;

insert into phase1_permission_smoke_ids (admin_id, target_id, admin_email, target_email)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'phase1-admin-smoke@vioo.local',
  'phase1-target-smoke@vioo.local'
);

delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase1_permission_smoke_ids)
   or target_user_id in (select target_id from phase1_permission_smoke_ids);
delete from public.users
where email in (
  select admin_email from phase1_permission_smoke_ids
  union all
  select target_email from phase1_permission_smoke_ids
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Phase 1 Smoke Admin', admin_email, 'phase1-smoke-admin', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase1_permission_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 1 Smoke Target', target_email, 'phase1-smoke-target', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase1_permission_smoke_ids;

set role authenticated;

select set_config('request.jwt.claim.email', (select admin_email from phase1_permission_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select admin_email from phase1_permission_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

select public.replace_user_permission_grants(
  (select target_id from phase1_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'system.wms.view',
    'scope_type', 'project',
    'scope_id', 'project-1',
    'is_active', true
  ))
);

do $$
declare
  v_target_id uuid := (select target_id from phase1_permission_smoke_ids);
begin
  if not app_private.has_permission(v_target_id, 'system.wms.view', 'project', 'project-1') then
    raise exception 'Active scoped grant did not allow matching scope';
  end if;

  if app_private.has_permission(v_target_id, 'system.wms.view', 'project', 'project-2') then
    raise exception 'Scoped grant incorrectly allowed wrong scope';
  end if;
end $$;

select public.replace_user_permission_grants(
  (select target_id from phase1_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'system.hrm.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', true,
    'expires_at', '2020-01-01T00:00:00Z'
  ))
);

do $$
declare
  v_target_id uuid := (select target_id from phase1_permission_smoke_ids);
begin
  if app_private.has_permission(v_target_id, 'system.hrm.view', 'global', '*') then
    raise exception 'Expired grant incorrectly allowed permission';
  end if;
end $$;

select public.replace_user_permission_grants(
  (select target_id from phase1_permission_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'system.ai.view',
    'scope_type', 'global',
    'scope_id', '*',
    'is_active', false
  ))
);

do $$
declare
  v_target_id uuid := (select target_id from phase1_permission_smoke_ids);
begin
  if app_private.has_permission(v_target_id, 'system.ai.view', 'global', '*') then
    raise exception 'Inactive grant incorrectly allowed permission';
  end if;
end $$;

select set_config('request.jwt.claim.email', (select target_email from phase1_permission_smoke_ids), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select target_email from phase1_permission_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
begin
  begin
    perform public.replace_user_permission_grants(
      (select target_id from phase1_permission_smoke_ids),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'system.wms.manage',
        'scope_type', 'global',
        'scope_id', '*',
        'is_active', true
      ))
    );
    raise exception 'Non-admin RPC mutation unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

do $$
begin
  begin
    insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
    values ((select target_id from phase1_permission_smoke_ids), 'system.wms.manage', 'global', '*', true);
    raise exception 'Non-admin direct grant mutation unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;

delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase1_permission_smoke_ids)
   or target_user_id in (select target_id from phase1_permission_smoke_ids);
delete from public.users
where id in (
  select admin_id from phase1_permission_smoke_ids
  union all
  select target_id from phase1_permission_smoke_ids
);
