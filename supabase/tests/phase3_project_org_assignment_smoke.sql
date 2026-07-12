-- Phase 3 Project Org assignment permission smoke.
-- Safe to run after Phase 1, Phase 2, Phase 3 surface, and Project Org assignment migrations.

do $$
begin
  if to_regprocedure('public.upsert_project_staff_assignment(jsonb)') is null then
    raise exception 'Missing public.upsert_project_staff_assignment(jsonb)';
  end if;

  if to_regprocedure('public.end_project_staff_assignment(uuid,date)') is null then
    raise exception 'Missing public.end_project_staff_assignment(uuid,date)';
  end if;

  if to_regprocedure('public.remove_project_staff_assignment(uuid)') is null then
    raise exception 'Missing public.remove_project_staff_assignment(uuid)';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('project_staff', 'project_staff_permissions')
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon still has Project Org table privileges';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('project_staff', 'project_staff_permissions')
      and g.grantee = 'authenticated'
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'authenticated still has direct Project Org write privileges';
  end if;
end $$;

create temp table if not exists phase3_project_org_assignment_smoke_ids (
  assigner_id uuid not null,
  granter_id uuid not null,
  viewer_id uuid not null,
  target_id uuid not null,
  project_id text not null,
  position_id uuid not null,
  staff_id uuid,
  assigner_email text not null,
  granter_email text not null,
  viewer_email text not null,
  target_email text not null
) on commit drop;

truncate table phase3_project_org_assignment_smoke_ids;
grant select, insert, update, delete on table phase3_project_org_assignment_smoke_ids to authenticated;

insert into phase3_project_org_assignment_smoke_ids (
  assigner_id,
  granter_id,
  viewer_id,
  target_id,
  project_id,
  position_id,
  assigner_email,
  granter_email,
  viewer_email,
  target_email
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase3-org-smoke-' || gen_random_uuid()::text,
  gen_random_uuid(),
  'phase3-org-assigner-smoke@vioo.local',
  'phase3-org-granter-smoke@vioo.local',
  'phase3-org-viewer-smoke@vioo.local',
  'phase3-org-target-smoke@vioo.local'
);

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase3_project_org_assignment_smoke_ids where staff_id is not null);
delete from public.project_staff
where project_id in (select project_id from phase3_project_org_assignment_smoke_ids)
   or user_id in (
     select target_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select viewer_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select assigner_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select granter_id::text from phase3_project_org_assignment_smoke_ids
   );
delete from public.permission_audit_events
where actor_user_id in (
  select assigner_id from phase3_project_org_assignment_smoke_ids
  union all
  select granter_id from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_id from phase3_project_org_assignment_smoke_ids
)
or target_user_id in (select target_id from phase3_project_org_assignment_smoke_ids);
delete from public.user_permission_grants
where user_id in (
  select assigner_id from phase3_project_org_assignment_smoke_ids
  union all
  select granter_id from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_id from phase3_project_org_assignment_smoke_ids
  union all
  select target_id from phase3_project_org_assignment_smoke_ids
);
delete from public.users
where email in (
  select assigner_email from phase3_project_org_assignment_smoke_ids
  union all
  select granter_email from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_email from phase3_project_org_assignment_smoke_ids
  union all
  select target_email from phase3_project_org_assignment_smoke_ids
);
delete from public.projects
where id in (select project_id from phase3_project_org_assignment_smoke_ids);
delete from public.hrm_positions
where id in (select position_id from phase3_project_org_assignment_smoke_ids);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select assigner_id, 'Phase 3 Org Assigner', assigner_email, 'phase3-org-assigner', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_org_assignment_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select granter_id, 'Phase 3 Org Granter', granter_email, 'phase3-org-granter', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_org_assignment_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select viewer_id, 'Phase 3 Org Viewer', viewer_email, 'phase3-org-viewer', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_org_assignment_smoke_ids;

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select target_id, 'Phase 3 Org Target', target_email, 'phase3-org-target', 'EMPLOYEE', true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_project_org_assignment_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PHASE3-ORG-SMOKE', 'Phase 3 Org Smoke', 'manual'
from phase3_project_org_assignment_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Phase 3 Org Smoke Position', 1, 'PHASE3-ORG-SMOKE', true, 0, 'smoke', '{"phase":"3","slice":"org"}'::jsonb
from phase3_project_org_assignment_smoke_ids;

insert into public.user_permission_grants (
  user_id,
  permission_code,
  scope_type,
  scope_id,
  is_active
)
select assigner_id, 'project.org.assign_staff', 'project', project_id, true
from phase3_project_org_assignment_smoke_ids
union all
select granter_id, 'project.org.grant_permissions', 'project', project_id, true
from phase3_project_org_assignment_smoke_ids
union all
select viewer_id, 'project.org.view', 'project', project_id, true
from phase3_project_org_assignment_smoke_ids;

set role authenticated;

select set_config('request.jwt.claim.email', (select viewer_email from phase3_project_org_assignment_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select viewer_email from phase3_project_org_assignment_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
begin
  begin
    perform public.upsert_project_staff_assignment(jsonb_build_object(
      'project_id', (select project_id from phase3_project_org_assignment_smoke_ids),
      'user_id', (select target_id::text from phase3_project_org_assignment_smoke_ids),
      'position_id', (select position_id::text from phase3_project_org_assignment_smoke_ids),
      'start_date', current_date::text
    ));
    raise exception 'project.org.view incorrectly allowed staff assignment';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.email', (select assigner_email from phase3_project_org_assignment_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select assigner_email from phase3_project_org_assignment_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
declare
  v_staff_id uuid;
begin
  begin
    insert into public.project_staff (project_id, user_id, position_id, start_date)
    select project_id, target_id::text, position_id, current_date
    from phase3_project_org_assignment_smoke_ids;
    raise exception 'Direct project_staff insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  select public.upsert_project_staff_assignment(jsonb_build_object(
    'project_id', (select project_id from phase3_project_org_assignment_smoke_ids),
    'user_id', (select target_id::text from phase3_project_org_assignment_smoke_ids),
    'position_id', (select position_id::text from phase3_project_org_assignment_smoke_ids),
    'start_date', current_date::text,
    'note', 'phase3 org assignment smoke'
  ))
  into v_staff_id;

  update phase3_project_org_assignment_smoke_ids
  set staff_id = v_staff_id;

  begin
    perform public.replace_project_staff_permission_grants(
      v_staff_id,
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'project.daily_log.view',
        'scope_type', 'project',
        'scope_id', (select project_id from phase3_project_org_assignment_smoke_ids),
        'is_active', true
      ))
    );
    raise exception 'project.org.assign_staff incorrectly allowed grant replacement';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.email', (select granter_email from phase3_project_org_assignment_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select granter_email from phase3_project_org_assignment_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

do $$
declare
  v_staff_id uuid := (select staff_id from phase3_project_org_assignment_smoke_ids);
begin
  begin
    perform public.upsert_project_staff_assignment(jsonb_build_object(
      'id', v_staff_id::text,
      'position_id', (select position_id::text from phase3_project_org_assignment_smoke_ids),
      'note', 'granter should not assign'
    ));
    raise exception 'project.org.grant_permissions incorrectly allowed assignment update';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.project_staff
    set note = 'direct update should fail'
    where id = v_staff_id;
    raise exception 'Direct project_staff update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  perform public.replace_project_staff_permission_grants(
    v_staff_id,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.daily_log.view',
      'scope_type', 'project',
      'scope_id', (select project_id from phase3_project_org_assignment_smoke_ids),
      'is_active', true
    ))
  );

  if not public.project_has_permission_v2(
    (select project_id from phase3_project_org_assignment_smoke_ids),
    null,
    'project.daily_log.view',
    (select target_id from phase3_project_org_assignment_smoke_ids)
  ) then
    raise exception 'project.org.grant_permissions did not grant target scoped permission';
  end if;
end $$;

select set_config('request.jwt.claim.email', (select assigner_email from phase3_project_org_assignment_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('email', (select assigner_email from phase3_project_org_assignment_smoke_ids), 'sub', current_setting('request.jwt.claim.sub', true))::text,
  true
);

select public.end_project_staff_assignment(
  (select staff_id from phase3_project_org_assignment_smoke_ids),
  current_date
);

do $$
begin
  if public.project_has_permission_v2(
    (select project_id from phase3_project_org_assignment_smoke_ids),
    null,
    'project.daily_log.view',
    (select target_id from phase3_project_org_assignment_smoke_ids)
  ) then
    raise exception 'Ended project staff assignment still has active scoped grant';
  end if;

  if exists (
    select 1
    from public.project_staff_permissions
    where staff_id = (select staff_id from phase3_project_org_assignment_smoke_ids)
      and coalesce(is_active, true)
  ) then
    raise exception 'Ended project staff assignment still has active synced legacy permissions';
  end if;
end $$;

select public.remove_project_staff_assignment(
  (select staff_id from phase3_project_org_assignment_smoke_ids)
);

reset role;

delete from public.project_staff_permissions
where staff_id in (select staff_id from phase3_project_org_assignment_smoke_ids where staff_id is not null);
delete from public.project_staff
where project_id in (select project_id from phase3_project_org_assignment_smoke_ids)
   or user_id in (
     select target_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select viewer_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select assigner_id::text from phase3_project_org_assignment_smoke_ids
     union all
     select granter_id::text from phase3_project_org_assignment_smoke_ids
   );
delete from public.permission_audit_events
where actor_user_id in (
  select assigner_id from phase3_project_org_assignment_smoke_ids
  union all
  select granter_id from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_id from phase3_project_org_assignment_smoke_ids
)
or target_user_id in (select target_id from phase3_project_org_assignment_smoke_ids);
delete from public.user_permission_grants
where user_id in (
  select assigner_id from phase3_project_org_assignment_smoke_ids
  union all
  select granter_id from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_id from phase3_project_org_assignment_smoke_ids
  union all
  select target_id from phase3_project_org_assignment_smoke_ids
);
delete from public.users
where id in (
  select assigner_id from phase3_project_org_assignment_smoke_ids
  union all
  select granter_id from phase3_project_org_assignment_smoke_ids
  union all
  select viewer_id from phase3_project_org_assignment_smoke_ids
  union all
  select target_id from phase3_project_org_assignment_smoke_ids
);
delete from public.projects
where id in (select project_id from phase3_project_org_assignment_smoke_ids);
delete from public.hrm_positions
where id in (select position_id from phase3_project_org_assignment_smoke_ids);
