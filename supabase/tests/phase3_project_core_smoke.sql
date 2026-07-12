-- Phase 3 Project core permission smoke.
-- Safe to run after Phase 1, Phase 2, and Phase 3 migrations; test rows are cleaned up.

do $$
declare
  required_codes text[] := array[
    'project.master.view',
    'project.master.create',
    'project.master.edit',
    'project.master.hide',
    'project.master.restore',
    'project.master.manage_categories',
    'project.org.grant_permissions',
    'project.dashboard.view_financials'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 core permission action: %', v_permission_code;
    end if;
  end loop;

  if to_regprocedure('public.project_has_permission_v2(text,text,text,uuid)') is null then
    raise exception 'Missing public.project_has_permission_v2(text,text,text,uuid)';
  end if;

  if to_regprocedure('app_private.project_has_any_permission_v2(text,text,text[],uuid)') is null then
    raise exception 'Missing app_private.project_has_any_permission_v2(text,text,text[],uuid)';
  end if;

  if to_regprocedure('public.list_project_permission_recipients(text,text,text[])') is null then
    raise exception 'Missing public.list_project_permission_recipients(text,text,text[])';
  end if;

  if to_regprocedure('public.delete_work_group(uuid)') is null then
    raise exception 'Missing public.delete_work_group(uuid)';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('projects', 'project_groups', 'project_types', 'project_sectors', 'work_groups', 'work_group_members')
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon still has Project core table privileges';
  end if;
end $$;

create temp table if not exists phase3_project_core_smoke_ids (
  admin_id uuid not null,
  target_id uuid not null,
  project_id text not null,
  other_project_id text not null,
  position_id uuid not null,
  staff_id uuid not null,
  admin_email text not null,
  target_email text not null
) on commit drop;

truncate table phase3_project_core_smoke_ids;
grant select, insert, update, delete on table phase3_project_core_smoke_ids to authenticated;

insert into phase3_project_core_smoke_ids (
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
  'phase3-core-smoke-' || gen_random_uuid()::text,
  'phase3-core-smoke-other-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  'phase3-core-admin-smoke@vioo.local',
  'phase3-core-target-smoke@vioo.local'
);

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase3_project_core_smoke_ids);
delete from public.project_staff
where id in (select staff_id from phase3_project_core_smoke_ids)
   or user_id in (select target_id::text from phase3_project_core_smoke_ids);
delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase3_project_core_smoke_ids)
   or target_user_id in (select target_id from phase3_project_core_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from phase3_project_core_smoke_ids);
delete from public.users
where email in (
  select admin_email from phase3_project_core_smoke_ids
  union all
  select target_email from phase3_project_core_smoke_ids
);
delete from public.projects
where id in (
  select project_id from phase3_project_core_smoke_ids
  union all
  select other_project_id from phase3_project_core_smoke_ids
);
delete from public.hrm_positions
where id in (select position_id from phase3_project_core_smoke_ids);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select admin_id, 'Phase 3 Core Smoke Admin', admin_email, 'phase3-core-smoke-admin', 'ADMIN', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_core_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 3 Core Smoke Target', target_email, 'phase3-core-smoke-target', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_core_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PHASE3-CORE-SMOKE', 'Phase 3 Core Smoke', 'manual'
from phase3_project_core_smoke_ids;

insert into public.projects (id, code, name, source)
select other_project_id, 'PHASE3-CORE-OTHER', 'Phase 3 Core Smoke Other', 'manual'
from phase3_project_core_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Phase 3 Core Smoke Position', 1, 'PHASE3-CORE-SMOKE', true, 0, 'smoke', '{"phase":"3"}'::jsonb
from phase3_project_core_smoke_ids;

insert into public.project_staff (id, project_id, construction_site_id, user_id, position_id, start_date, note)
select staff_id, phase3_project_core_smoke_ids.project_id, null, target_id::text, position_id, current_date, 'phase3 core smoke'
from phase3_project_core_smoke_ids;

set role authenticated;

select set_config('request.jwt.claim.email', (select admin_email from phase3_project_core_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select admin_email from phase3_project_core_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

select public.replace_project_staff_permission_grants(
  (select staff_id from phase3_project_core_smoke_ids),
  jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'project.master.view',
      'scope_type', 'project',
      'scope_id', (select project_id from phase3_project_core_smoke_ids),
      'is_active', true
    ),
    jsonb_build_object(
      'permission_code', 'project.dashboard.view_financials',
      'scope_type', 'project',
      'scope_id', (select project_id from phase3_project_core_smoke_ids),
      'is_active', true
    )
  )
);

do $$
declare
  v_target_id uuid := (select target_id from phase3_project_core_smoke_ids);
  v_project_id text := (select project_id from phase3_project_core_smoke_ids);
  v_other_project_id text := (select other_project_id from phase3_project_core_smoke_ids);
  v_recipient_count int;
begin
  if not public.project_has_permission_v2(v_project_id, null, 'project.master.view', v_target_id) then
    raise exception 'project.master.view grant did not allow matching project';
  end if;

  if public.project_has_permission_v2(v_other_project_id, null, 'project.master.view', v_target_id) then
    raise exception 'project.master.view grant incorrectly allowed another project';
  end if;

  if public.project_has_permission_v2(v_project_id, null, 'project.master.edit', v_target_id) then
    raise exception 'project.master.view incorrectly implied project.master.edit';
  end if;

  if not public.project_scope_has_any_grant_v2(v_project_id, null, v_target_id) then
    raise exception 'Project shell helper did not detect scoped grant';
  end if;

  select count(*)
  into v_recipient_count
  from public.list_project_permission_recipients(
    v_project_id,
    null,
    array['project.dashboard.view_financials']::text[]
  );

  if v_recipient_count <> 1 then
    raise exception 'Expected exactly one Phase 3 permission recipient, got %', v_recipient_count;
  end if;
end $$;

reset role;

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase3_project_core_smoke_ids);
delete from public.project_staff
where id in (select staff_id from phase3_project_core_smoke_ids);
delete from public.permission_audit_events
where actor_user_id in (select admin_id from phase3_project_core_smoke_ids)
   or target_user_id in (select target_id from phase3_project_core_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from phase3_project_core_smoke_ids);
delete from public.users
where id in (
  select admin_id from phase3_project_core_smoke_ids
  union all
  select target_id from phase3_project_core_smoke_ids
);
delete from public.project_staff
where project_id in (
  select project_id from phase3_project_core_smoke_ids
  union all
  select other_project_id from phase3_project_core_smoke_ids
);
delete from public.projects
where id in (
  select project_id from phase3_project_core_smoke_ids
  union all
  select other_project_id from phase3_project_core_smoke_ids
);
delete from public.hrm_positions
where id in (select position_id from phase3_project_core_smoke_ids);
