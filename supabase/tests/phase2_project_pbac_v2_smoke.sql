-- Phase 2 Project PBAC v2 smoke checks.
-- Safe to run after the Phase 2 migration; test rows are cleaned up at the end.

do $$
declare
  required_modules text[] := array[
    'project.overview',
    'project.org',
    'project.executive',
    'project.daily_log',
    'project.material_request',
    'project.material_plan',
    'project.material_boq',
    'project.material_po',
    'project.custom_material',
    'project.gantt',
    'project.weekly_progress',
    'project.contract',
    'project.subcontract',
    'project.payment',
    'project.quantity_acceptance',
    'project.cashflow',
    'project.budget',
    'project.quality',
    'project.safety',
    'project.documents',
    'project.report'
  ];
  module_code text;
begin
  foreach module_code in array required_modules loop
    if not exists (
      select 1
      from public.permission_modules
      where code = module_code
        and application_code = 'project'
        and coalesce(is_active, true)
    ) then
      raise exception 'Missing Project PBAC v2 module: %', module_code;
    end if;
  end loop;

  if not exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'project.org.grant_permissions',
      'project.daily_log.verify',
      'project.daily_log.delete_own',
      'project.material_po.receive',
      'project.payment.mark_paid',
      'project.documents.upload',
      'project.report.export'
    )
  ) then
    raise exception 'Required Project PBAC v2 actions are missing';
  end if;

  if to_regprocedure('app_private.has_explicit_permission(uuid,text,text,text)') is null then
    raise exception 'Missing app_private.has_explicit_permission(uuid,text,text,text)';
  end if;

  if to_regprocedure('app_private.project_has_permission_v2(text,text,text,uuid)') is null then
    raise exception 'Missing app_private.project_has_permission_v2(text,text,text,uuid)';
  end if;

  if to_regprocedure('public.replace_project_staff_permission_grants(uuid,jsonb)') is null then
    raise exception 'Missing public.replace_project_staff_permission_grants(uuid,jsonb)';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('user_permission_grants', 'permission_actions', 'permission_modules')
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon has privileges on Phase 2 permission tables';
  end if;
end $$;

create temp table if not exists phase2_project_pbac_smoke_ids (
  admin_id uuid not null,
  target_id uuid not null,
  project_id text not null,
  other_project_id text not null,
  position_id uuid not null,
  staff_id uuid not null,
  admin_email text not null,
  target_email text not null
) on commit drop;

truncate table phase2_project_pbac_smoke_ids;
grant select, insert, update, delete on table phase2_project_pbac_smoke_ids to authenticated;

insert into phase2_project_pbac_smoke_ids (
  admin_id,
  target_id,
  project_id,
  other_project_id,
  position_id,
  staff_id,
  admin_email,
  target_email
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-pbac-smoke-' || gen_random_uuid()::text,
  'phase2-pbac-smoke-other-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-project-admin-smoke@vioo.local',
  'phase2-project-target-smoke@vioo.local'
);

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase2_project_pbac_smoke_ids);
delete from public.project_staff
where id in (select staff_id from phase2_project_pbac_smoke_ids)
   or user_id in (select target_id::text from phase2_project_pbac_smoke_ids);
delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase2_project_pbac_smoke_ids)
   or target_user_id in (select target_id from phase2_project_pbac_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from phase2_project_pbac_smoke_ids);
delete from public.users
where email in (
  select admin_email from phase2_project_pbac_smoke_ids
  union all
  select target_email from phase2_project_pbac_smoke_ids
);
delete from public.projects
where id in (
  select project_id from phase2_project_pbac_smoke_ids
  union all
  select other_project_id from phase2_project_pbac_smoke_ids
);
delete from public.hrm_positions
where id in (select position_id from phase2_project_pbac_smoke_ids);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Phase 2 Project Smoke Admin', admin_email, 'phase2-project-smoke-admin', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_project_pbac_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 2 Project Smoke Target', target_email, 'phase2-project-smoke-target', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_project_pbac_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PHASE2-PBAC-SMOKE', 'Phase 2 Project PBAC Smoke', 'manual'
from phase2_project_pbac_smoke_ids;

insert into public.projects (id, code, name, source)
select other_project_id, 'PHASE2-PBAC-SMOKE-OTHER', 'Phase 2 Other Project PBAC Smoke', 'manual'
from phase2_project_pbac_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Phase 2 PBAC Smoke Position', 1, 'PHASE2-PBAC-SMOKE', true, 0, 'smoke', '{"phase":"2"}'::jsonb
from phase2_project_pbac_smoke_ids;

insert into public.project_staff (id, project_id, construction_site_id, user_id, position_id, start_date, note)
select staff_id, project_id::text, null, target_id::text, position_id, current_date, 'phase2 smoke'
from phase2_project_pbac_smoke_ids;

set role authenticated;

select set_config('request.jwt.claim.email', (select admin_email from phase2_project_pbac_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select admin_email from phase2_project_pbac_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

select public.replace_project_staff_permission_grants(
  (select staff_id from phase2_project_pbac_smoke_ids),
  jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'project.daily_log.view',
      'scope_type', 'project',
      'scope_id', (select project_id::text from phase2_project_pbac_smoke_ids),
      'is_active', true
    ),
    jsonb_build_object(
      'permission_code', 'project.daily_log.create',
      'scope_type', 'project',
      'scope_id', (select project_id::text from phase2_project_pbac_smoke_ids),
      'is_active', true
    ),
    jsonb_build_object(
      'permission_code', 'project.material_request.view_available_stock',
      'scope_type', 'project',
      'scope_id', (select project_id::text from phase2_project_pbac_smoke_ids),
      'is_active', true
    )
  )
);

do $$
declare
  v_target_id uuid := (select target_id from phase2_project_pbac_smoke_ids);
  v_project_id text := (select project_id::text from phase2_project_pbac_smoke_ids);
  v_other_project_id text := (select other_project_id::text from phase2_project_pbac_smoke_ids);
  v_staff_id uuid := (select staff_id from phase2_project_pbac_smoke_ids);
begin
  if not app_private.project_has_permission_v2(v_project_id, null, 'project.daily_log.view', v_target_id) then
    raise exception 'Project-scoped daily_log.view grant did not allow matching project';
  end if;

  if app_private.project_has_permission_v2(v_other_project_id, null, 'project.daily_log.view', v_target_id) then
    raise exception 'Project-scoped daily_log.view grant incorrectly allowed another project';
  end if;

  if app_private.project_has_permission_v2(v_project_id, null, 'project.daily_log.approve', v_target_id) then
    raise exception 'daily_log.view/create incorrectly implied approve';
  end if;

  if not app_private.has_explicit_permission(v_target_id, 'project.daily_log.create', 'project', v_project_id) then
    raise exception 'Explicit create grant did not pass has_explicit_permission';
  end if;

  if not exists (
    select 1
    from public.project_staff_permissions psp
    join public.project_permission_types ppt on ppt.id = psp.permission_type_id
    where psp.staff_id = v_staff_id
      and ppt.code in ('view', 'edit', 'view_available_stock')
    group by psp.staff_id
    having count(distinct ppt.code) = 3
  ) then
    raise exception 'RPC did not sync Project PBAC v2 grants back to legacy project_staff_permissions';
  end if;
end $$;

select public.replace_project_staff_permission_grants(
  (select staff_id from phase2_project_pbac_smoke_ids),
  jsonb_build_array(jsonb_build_object(
    'permission_code', 'project.daily_log.approve',
    'scope_type', 'project',
    'scope_id', (select project_id::text from phase2_project_pbac_smoke_ids),
    'is_active', true,
    'expires_at', '2020-01-01T00:00:00Z'
  ))
);

do $$
declare
  v_target_id uuid := (select target_id from phase2_project_pbac_smoke_ids);
  v_project_id text := (select project_id::text from phase2_project_pbac_smoke_ids);
begin
  if app_private.project_has_permission_v2(v_project_id, null, 'project.daily_log.approve', v_target_id) then
    raise exception 'Expired Project PBAC v2 grant incorrectly allowed permission';
  end if;
end $$;

select set_config('request.jwt.claim.email', (select target_email from phase2_project_pbac_smoke_ids), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select target_email from phase2_project_pbac_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
begin
  begin
    perform public.replace_project_staff_permission_grants(
      (select staff_id from phase2_project_pbac_smoke_ids),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'project.daily_log.approve',
        'scope_type', 'project',
        'scope_id', (select project_id::text from phase2_project_pbac_smoke_ids),
        'is_active', true
      ))
    );
    raise exception 'Non-admin Project PBAC v2 RPC mutation unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

do $$
begin
  begin
    insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
    values (
      (select target_id from phase2_project_pbac_smoke_ids),
      'project.daily_log.approve',
      'project',
      (select project_id::text from phase2_project_pbac_smoke_ids),
      true
    );
    raise exception 'Non-admin direct user_permission_grants insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase2_project_pbac_smoke_ids);
delete from public.project_staff
where id in (select staff_id from phase2_project_pbac_smoke_ids);
delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase2_project_pbac_smoke_ids)
   or target_user_id in (select target_id from phase2_project_pbac_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from phase2_project_pbac_smoke_ids);
delete from public.users
where id in (
  select admin_id from phase2_project_pbac_smoke_ids
  union all
  select target_id from phase2_project_pbac_smoke_ids
);
delete from public.project_staff
where project_id in (
  select project_id::text from phase2_project_pbac_smoke_ids
  union all
  select other_project_id::text from phase2_project_pbac_smoke_ids
);
delete from public.projects
where id in (
  select project_id from phase2_project_pbac_smoke_ids
  union all
  select other_project_id from phase2_project_pbac_smoke_ids
);
delete from public.hrm_positions
where id in (select position_id from phase2_project_pbac_smoke_ids);
