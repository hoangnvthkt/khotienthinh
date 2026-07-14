-- Phase 3.2 Daily Log permission smoke.
-- Run transactionally after Phase 1, Phase 2, Phase 3 surface, Project Org, and Daily Log namespace migrations.

begin;

do $$
declare
  required_codes text[] := array[
    'project.daily_log.view',
    'project.daily_log.create',
    'project.daily_log.edit_own',
    'project.daily_log.edit_all',
    'project.daily_log.delete_own',
    'project.daily_log.delete_all',
    'project.daily_log.submit',
    'project.daily_log.return',
    'project.daily_log.verify',
    'project.daily_log.approve',
    'project.daily_log.summarize'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and pa.module_code = 'project.daily_log'
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 Daily Log permission action: %', v_permission_code;
    end if;
  end loop;

  if to_regprocedure('public.transition_daily_log_status(text,text,text,text,text)') is null then
    raise exception 'Missing public.transition_daily_log_status(text,text,text,text,text)';
  end if;

  if to_regprocedure('app_private.guard_daily_log_direct_status_update()') is null then
    raise exception 'Missing app_private.guard_daily_log_direct_status_update()';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in (
        'daily_logs',
        'daily_log_volumes',
        'daily_log_materials',
        'daily_log_labor',
        'daily_log_machines',
        'daily_log_summary_sources'
      )
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon still has Daily Log table privileges';
  end if;
end $$;

create temp table phase3_daily_log_smoke_ids (
  project_id text not null,
  no_staff_project_id text not null,
  position_id uuid not null,
  viewer_id uuid not null,
  creator_id uuid not null,
  owner_id uuid not null,
  editor_id uuid not null,
  verifier_id uuid not null,
  approver_id uuid not null,
  returner_id uuid not null,
  nogrant_id uuid not null,
  viewer_email text not null,
  creator_email text not null,
  owner_email text not null,
  editor_email text not null,
  verifier_email text not null,
  approver_email text not null,
  returner_email text not null,
  nogrant_email text not null
) on commit drop;

grant select, insert, update, delete on table phase3_daily_log_smoke_ids to authenticated;

insert into phase3_daily_log_smoke_ids
values (
  'phase3-daily-log-smoke-' || gen_random_uuid()::text,
  'phase3-daily-log-nostaff-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase3-dl-viewer@vioo.local',
  'phase3-dl-creator@vioo.local',
  'phase3-dl-owner@vioo.local',
  'phase3-dl-editor@vioo.local',
  'phase3-dl-verifier@vioo.local',
  'phase3-dl-approver@vioo.local',
  'phase3-dl-returner@vioo.local',
  'phase3-dl-nogrant@vioo.local'
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select viewer_id, 'Phase 3 DL Viewer', viewer_email, 'phase3-dl-viewer', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select creator_id, 'Phase 3 DL Creator', creator_email, 'phase3-dl-creator', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select owner_id, 'Phase 3 DL Owner', owner_email, 'phase3-dl-owner', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select editor_id, 'Phase 3 DL Editor', editor_email, 'phase3-dl-editor', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select verifier_id, 'Phase 3 DL Verifier', verifier_email, 'phase3-dl-verifier', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select approver_id, 'Phase 3 DL Approver', approver_email, 'phase3-dl-approver', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select returner_id, 'Phase 3 DL Returner', returner_email, 'phase3-dl-returner', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids
union all
select nogrant_id, 'Phase 3 DL No Grant', nogrant_email, 'phase3-dl-nogrant', 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_daily_log_smoke_ids;

insert into public.projects (id, code, name, source)
select project_id, 'PHASE3-DL-SMOKE', 'Phase 3 Daily Log Smoke', 'manual'
from phase3_daily_log_smoke_ids
union all
select no_staff_project_id, 'PHASE3-DL-NOSTAFF', 'Phase 3 Daily Log No Staff Smoke', 'manual'
from phase3_daily_log_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Phase 3 Daily Log Smoke Position', 1, 'PHASE3-DL-SMOKE', true, 0, 'smoke', '{"phase":"3.2","slice":"daily_log"}'::jsonb
from phase3_daily_log_smoke_ids;

insert into public.project_staff (project_id, user_id, position_id, start_date)
select s.project_id, u.user_id::text, s.position_id, current_date
from phase3_daily_log_smoke_ids s
cross join lateral (
  values
    (s.viewer_id),
    (s.creator_id),
    (s.owner_id),
    (s.editor_id),
    (s.verifier_id),
    (s.approver_id),
    (s.returner_id),
    (s.nogrant_id)
) as u(user_id);

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select viewer_id, 'project.daily_log.view', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select creator_id, 'project.daily_log.create', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select owner_id, 'project.daily_log.create', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select owner_id, 'project.daily_log.edit_own', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select owner_id, 'project.daily_log.delete_own', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select owner_id, 'project.daily_log.submit', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select editor_id, 'project.daily_log.edit_all', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select verifier_id, 'project.daily_log.verify', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select approver_id, 'project.daily_log.approve', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select returner_id, 'project.daily_log.return', 'project', project_id, true
from phase3_daily_log_smoke_ids
union all
select returner_id, 'project.daily_log.verify', 'project', project_id, true
from phase3_daily_log_smoke_ids;

insert into public.daily_logs (
  id,
  project_id,
  construction_site_id,
  date,
  weather,
  worker_count,
  description,
  status,
  verified,
  created_by,
  created_by_id,
  created_at,
  submitted_to_permission,
  submitted_to_user_id,
  requested_verifier_id
)
select 'phase3-dl-owner-draft', project_id, null, current_date, 'sunny', 1, 'owner draft', 'draft', false, owner_id::text, owner_id::text, now(), null, null, null
from phase3_daily_log_smoke_ids
union all
select 'phase3-dl-other-draft', project_id, null, current_date, 'sunny', 1, 'other draft', 'draft', false, creator_id::text, creator_id::text, now(), null, null, null
from phase3_daily_log_smoke_ids
union all
select 'phase3-dl-submittable', project_id, null, current_date, 'sunny', 1, 'submittable', 'draft', false, owner_id::text, owner_id::text, now(), null, null, null
from phase3_daily_log_smoke_ids
union all
select 'phase3-dl-approve-step', project_id, null, current_date, 'sunny', 1, 'approve step', 'submitted', false, owner_id::text, owner_id::text, now(), 'approve', verifier_id::text, verifier_id::text
from phase3_daily_log_smoke_ids
union all
select 'phase3-dl-return-step', project_id, null, current_date, 'sunny', 1, 'return step', 'submitted', false, owner_id::text, owner_id::text, now(), 'verify', verifier_id::text, verifier_id::text
from phase3_daily_log_smoke_ids
union all
select 'phase3-dl-return-ok', project_id, null, current_date, 'sunny', 1, 'return ok', 'submitted', false, owner_id::text, owner_id::text, now(), 'verify', returner_id::text, returner_id::text
from phase3_daily_log_smoke_ids;

set role authenticated;

create temp table phase3_daily_log_smoke_user (
  email text not null,
  user_id uuid not null
) on commit drop;
grant select, insert, update, delete on table phase3_daily_log_smoke_user to authenticated;

create or replace function pg_temp.phase3_daily_log_smoke_set_user(p_email text, p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.email', p_email, true);
  select set_config('request.jwt.claim.sub', p_user_id::text, true);
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('email', p_email, 'sub', p_user_id::text)::text,
    true
  );
$$;

select pg_temp.phase3_daily_log_smoke_set_user(viewer_email, viewer_id)
from phase3_daily_log_smoke_ids;

do $$
begin
  begin
    insert into public.daily_logs (id, project_id, date, weather, worker_count, description, status, verified, created_by_id, created_by, created_at)
    select 'phase3-dl-viewer-create-deny', project_id, current_date, 'sunny', 1, 'viewer cannot create', 'draft', false, viewer_id::text, viewer_id::text, now()
    from phase3_daily_log_smoke_ids;
    raise exception 'project.daily_log.view incorrectly allowed create';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(creator_email, creator_id)
from phase3_daily_log_smoke_ids;

insert into public.daily_logs (id, project_id, date, weather, worker_count, description, status, verified, created_by_id, created_by, created_at)
select 'phase3-dl-create-only', project_id, current_date, 'sunny', 1, 'create only', 'draft', false, creator_id::text, creator_id::text, now()
from phase3_daily_log_smoke_ids;

do $$
begin
  begin
    perform public.transition_daily_log_status(
      'phase3-dl-create-only',
      'submitted',
      (select verifier_id::text from phase3_daily_log_smoke_ids),
      'Phase 3 DL Verifier',
      null
    );
    raise exception 'project.daily_log.create incorrectly allowed submit';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(owner_email, owner_id)
from phase3_daily_log_smoke_ids;

update public.daily_logs
set description = 'owner edited draft'
where id = 'phase3-dl-owner-draft';

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-owner-draft'
      and description = 'owner edited draft'
  ) then
    raise exception 'owner with edit_own could not edit own draft';
  end if;

  update public.daily_logs
  set description = 'owner incorrectly edited other draft'
  where id = 'phase3-dl-other-draft';

  if exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-other-draft'
      and description = 'owner incorrectly edited other draft'
  ) then
    raise exception 'edit_own incorrectly edited another user daily log';
  end if;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(editor_email, editor_id)
from phase3_daily_log_smoke_ids;

update public.daily_logs
set description = 'editor edited other draft'
where id = 'phase3-dl-other-draft';

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-other-draft'
      and description = 'editor edited other draft'
  ) then
    raise exception 'edit_all could not edit another user daily log';
  end if;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(owner_email, owner_id)
from phase3_daily_log_smoke_ids;

do $$
begin
  begin
    update public.daily_logs
    set status = 'submitted'
    where id = 'phase3-dl-owner-draft';
    raise exception 'direct daily_logs.status update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select public.transition_daily_log_status(
  'phase3-dl-submittable',
  'submitted',
  (select verifier_id::text from phase3_daily_log_smoke_ids),
  'Phase 3 DL Verifier',
  null
);

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-submittable'
      and status = 'submitted'
      and submitted_to_user_id = (select verifier_id::text from phase3_daily_log_smoke_ids)
  ) then
    raise exception 'owner with submit could not submit to verifier';
  end if;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(verifier_email, verifier_id)
from phase3_daily_log_smoke_ids;

select public.transition_daily_log_status('phase3-dl-submittable', 'verified', null, null, null);

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-submittable'
      and status = 'verified'
      and verified = true
  ) then
    raise exception 'verifier handler could not verify submitted daily log';
  end if;

  begin
    perform public.transition_daily_log_status('phase3-dl-approve-step', 'verified', null, null, null);
    raise exception 'project.daily_log.verify incorrectly allowed approve step';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.transition_daily_log_status('phase3-dl-return-step', 'rejected', null, null, 'Need return permission');
    raise exception 'project.daily_log.verify incorrectly allowed return';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(returner_email, returner_id)
from phase3_daily_log_smoke_ids;

select public.transition_daily_log_status('phase3-dl-return-ok', 'rejected', null, null, 'Return by explicit permission');

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'phase3-dl-return-ok'
      and status = 'rejected'
      and verified = false
  ) then
    raise exception 'return permission could not reject submitted daily log';
  end if;
end $$;

select pg_temp.phase3_daily_log_smoke_set_user(nogrant_email, nogrant_id)
from phase3_daily_log_smoke_ids;

do $$
begin
  begin
    insert into public.daily_logs (id, project_id, date, weather, worker_count, description, status, verified, created_by_id, created_by, created_at)
    select 'phase3-dl-nostaff-mutate-deny', no_staff_project_id, current_date, 'sunny', 1, 'no staff fallback cannot mutate', 'draft', false, nogrant_id::text, nogrant_id::text, now()
    from phase3_daily_log_smoke_ids;
    raise exception 'no-staff/no-PBAC fallback incorrectly allowed mutation';
  exception
    when insufficient_privilege then null;
  end;
end $$;

rollback;
