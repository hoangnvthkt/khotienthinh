-- Run after a local reset:
-- npx --yes supabase@2.110.0 db query --local --file supabase/tests/weekly_progress_period_state_smoke.sql
--
-- Two-session serialization plan (requires two independent psql sessions):
-- 1. Seed these fixtures, then have session A begin and hold the target period
--    state row FOR UPDATE as the database owner.
-- 2. In session A, set the confirmer JWT claims, call close, and leave the
--    transaction uncommitted. In session B, set the editor claims and call save.
-- 3. Verify session B is waiting in pg_stat_activity; commit session A; verify
--    session B returns SQLSTATE 23514 and none of its payload rows were written.
-- 4. Repeat in reverse order (save in A, close in B) and verify close observes
--    the committed save before locking. This cannot be represented by this
--    single-connection smoke transaction.

begin;

do $$
declare
  v_room public.project_permission_rooms%rowtype;
begin
  select * into v_room
  from public.project_permission_rooms
  where code = 'weekly_progress';

  if v_room.allowed_actions <> array['view', 'edit', 'confirm']::text[]
    or cardinality(v_room.required_actions) <> 0 then
    raise exception 'weekly_progress Room must expose only view/edit/confirm with no required recipient';
  end if;

  if (
    select count(*)
    from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'weekly_progress'
      and binding.enforcement_status = 'pilot'
      and binding.pbac_fallback_enabled
      and binding.action_code in ('view', 'edit', 'confirm')
      and binding.legacy_permission_codes = case binding.action_code
        when 'view' then array['project.weekly_progress.view']::text[]
        when 'edit' then array['project.weekly_progress.create', 'project.weekly_progress.edit_all']::text[]
        when 'confirm' then array['project.weekly_progress.lock']::text[]
      end
      and binding.prerequisite_action_codes = case binding.action_code
        when 'view' then '{}'::text[]
        else array['view']::text[]
      end
  ) <> 3 then
    raise exception 'weekly_progress Room pilot bindings are incomplete';
  end if;

  if exists (
    select 1
    from app_private.project_permission_room_action_bindings
    where room_code = 'weekly_progress'
      and action_code in ('submit', 'verify', 'approve')
  ) or exists (
    select 1
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id
    where member.room_code = 'weekly_progress'
      and action.action_code in ('submit', 'verify', 'approve')
  ) then
    raise exception 'obsolete weekly_progress Room actions were retained or converted';
  end if;

  if (
    select count(*)
    from public.permission_actions action
    where action.permission_code in (
      'project.weekly_progress.submit',
      'project.weekly_progress.verify',
      'project.weekly_progress.approve'
    )
  ) <> 3 then
    raise exception 'legacy weekly progress PBAC definitions must remain available for audit';
  end if;

  if to_regclass('public.project_progress_period_states') is null
    or to_regprocedure('public.get_project_progress_period_state(text,text,text,date)') is null
    or to_regprocedure('public.save_project_progress_period(text,text,text,date,jsonb,jsonb)') is null
    or to_regprocedure('public.close_project_progress_period(text,text,text,date,jsonb,jsonb)') is null
    or to_regprocedure('public.reopen_project_progress_period(text,text,text,date,text)') is null
    or to_regprocedure('public.preflight_project_progress_snapshot(text,text,date,jsonb)') is null
    or to_regprocedure('public.refresh_project_progress_snapshot(text,text,date,jsonb)') is null
    or to_regprocedure('public.prepare_project_opening_balance_snapshot(uuid)') is null
    or to_regprocedure('public.get_project_opening_balance_snapshot_retry(uuid)') is null
    or to_regprocedure('public.sync_project_opening_balance_snapshot(uuid)') is null then
    raise exception 'weekly progress period-state RPC surface is incomplete';
  end if;

  if has_function_privilege('anon', 'public.get_project_progress_period_state(text,text,text,date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.save_project_progress_period(text,text,text,date,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.close_project_progress_period(text,text,text,date,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.reopen_project_progress_period(text,text,text,date,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.preflight_project_progress_snapshot(text,text,date,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.refresh_project_progress_snapshot(text,text,date,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.prepare_project_opening_balance_snapshot(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_project_opening_balance_snapshot_retry(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.sync_project_opening_balance_snapshot(uuid)', 'EXECUTE') then
    raise exception 'anon unexpectedly has a weekly progress RPC grant';
  end if;

  if exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'get_project_progress_period_state',
        'save_project_progress_period',
        'close_project_progress_period',
        'reopen_project_progress_period',
        'preflight_project_progress_snapshot',
        'refresh_project_progress_snapshot',
        'prepare_project_opening_balance_snapshot',
        'get_project_opening_balance_snapshot_retry',
        'sync_project_opening_balance_snapshot'
      )
      and routine.prosecdef
  ) or exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'app_private'
      and routine.proname in (
        'get_project_progress_period_state_impl',
        'save_project_progress_period_impl',
        'close_project_progress_period_impl',
        'reopen_project_progress_period_impl',
        'preflight_project_progress_snapshot_impl',
        'refresh_project_progress_snapshot_impl',
        'prepare_project_opening_balance_snapshot_impl',
        'get_project_opening_balance_snapshot_retry_impl',
        'sync_project_opening_balance_snapshot_impl'
      )
      and not routine.prosecdef
  ) then
    raise exception 'public wrappers must be invoker and private implementations must be definer';
  end if;

  if has_table_privilege('authenticated', 'public.project_daily_task_progress', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.project_weekly_task_progress', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.weekly_progress_snapshots', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.project_progress_period_states', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated retains direct progress mutation privileges';
  end if;

  if has_function_privilege(
    'authenticated', 'public.refresh_project_progress_snapshot(text,text,date,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'app_private.refresh_project_progress_snapshot_impl(text,text,date,jsonb)', 'EXECUTE'
  ) then
    raise exception 'authenticated retains the unbound snapshot refresh capability';
  end if;

  if has_table_privilege('authenticated', 'public.project_opening_balances', 'DELETE')
    or has_column_privilege('authenticated', 'public.project_opening_balances', 'progress_snapshot_status', 'SELECT,INSERT,UPDATE')
    or has_column_privilege('authenticated', 'public.project_opening_balances', 'progress_snapshot_payload', 'SELECT,INSERT,UPDATE')
    or has_column_privilege('authenticated', 'public.project_opening_balances', 'progress_snapshot_refreshed_at', 'SELECT,INSERT,UPDATE') then
    raise exception 'authenticated retains direct Opening Balance retry metadata access';
  end if;
end $$;

create temp table weekly_progress_smoke_ids (
  admin_id uuid not null,
  viewer_id uuid not null,
  editor_id uuid not null,
  confirmer_id uuid not null,
  outsider_id uuid not null,
  keeper_id uuid not null,
  obsolete_actor_id uuid not null,
  project_id text not null,
  other_project_id text not null,
  site_id uuid not null,
  other_site_id uuid not null,
  position_id uuid not null,
  viewer_staff_id uuid not null,
  editor_staff_id uuid not null,
  confirmer_staff_id uuid not null,
  outsider_staff_id uuid not null,
  obsolete_actor_staff_id uuid not null,
  opening_balance_id uuid not null,
  task_id text not null,
  parent_task_id text not null,
  other_task_id text not null,
  admin_email text not null,
  viewer_email text not null,
  editor_email text not null,
  confirmer_email text not null,
  outsider_email text not null,
  keeper_email text not null,
  obsolete_actor_email text not null
) on commit drop;

insert into weekly_progress_smoke_ids values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  'weekly-progress-smoke-' || gen_random_uuid()::text,
  'weekly-progress-other-' || gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(),
  'weekly-progress-task-' || gen_random_uuid()::text,
  'weekly-progress-parent-task-' || gen_random_uuid()::text,
  'weekly-progress-other-task-' || gen_random_uuid()::text,
  'weekly-progress-admin@vioo.local',
  'weekly-progress-viewer@vioo.local',
  'weekly-progress-editor@vioo.local',
  'weekly-progress-confirmer@vioo.local',
  'weekly-progress-outsider@vioo.local',
  'weekly-progress-keeper@vioo.local',
  'weekly-progress-obsolete@vioo.local'
);

grant select on weekly_progress_smoke_ids to authenticated;

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select admin_id, 'Weekly Progress Admin', admin_email, 'weekly-progress-admin', 'ADMIN'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select viewer_id, 'Weekly Progress Viewer', viewer_email, 'weekly-progress-viewer', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select editor_id, 'Weekly Progress Editor', editor_email, 'weekly-progress-editor', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select confirmer_id, 'Weekly Progress Confirmer', confirmer_email, 'weekly-progress-confirmer', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select outsider_id, 'Weekly Progress Outsider', outsider_email, 'weekly-progress-outsider', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select keeper_id, 'Weekly Progress Global Keeper', keeper_email, 'weekly-progress-keeper', 'WAREHOUSE_KEEPER'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids
union all
select obsolete_actor_id, 'Weekly Progress Obsolete Actor', obsolete_actor_email, 'weekly-progress-obsolete', 'EMPLOYEE'::public.user_role, true,
  '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb from weekly_progress_smoke_ids;

insert into public.hrm_construction_sites (id, name)
select site_id, 'Weekly Progress Smoke Site' from weekly_progress_smoke_ids
union all
select other_site_id, 'Weekly Progress Other Site' from weekly_progress_smoke_ids;

insert into public.projects (id, code, name, construction_site_id, source)
select project_id, 'WEEKLY-PROGRESS-SMOKE', 'Weekly Progress Smoke', site_id, 'manual'
from weekly_progress_smoke_ids
union all
select other_project_id, 'WEEKLY-PROGRESS-OTHER', 'Weekly Progress Other', other_site_id, 'manual'
from weekly_progress_smoke_ids;

-- Seed legacy retry metadata with a deliberately mismatched project/site/week.
-- The ID-only RPCs must derive the canonical payload from this balance row.
insert into public.project_opening_balances (
  id, scope_key, project_id, construction_site_id, as_of_date, contract_value,
  construction_progress_percent, purchased_value, issued_value, used_value,
  recognized_value, status, progress_snapshot_status, progress_snapshot_payload,
  progress_snapshot_refreshed_at
)
select
  opening_balance_id, project_id || '_' || site_id::text, project_id, site_id::text,
  date '2026-08-08', 2000, 41, 800, 500, 410, 410, 'locked', 'synced',
  jsonb_build_object(
    'projectId', other_project_id,
    'constructionSiteId', other_site_id::text,
    'weekStart', '2026-08-10',
    'constructionProgressPercent', 99,
    'valueProgressPercent', 99,
    'progressMode', 'opening_balance'
  ),
  now()
from weekly_progress_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Weekly Progress Smoke Position', 1, 'WEEKLY-PROGRESS-SMOKE', true, 0, 'smoke', '{}'::jsonb
from weekly_progress_smoke_ids;

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id, start_date, end_date, note
)
select viewer_staff_id, project_id, site_id::text, viewer_id::text, position_id, current_date, null, 'Viewer'
from weekly_progress_smoke_ids
union all
select editor_staff_id, project_id, site_id::text, editor_id::text, position_id, current_date, null, 'Editor'
from weekly_progress_smoke_ids
union all
select confirmer_staff_id, project_id, site_id::text, confirmer_id::text, position_id, current_date, null, 'Confirmer'
from weekly_progress_smoke_ids
union all
select outsider_staff_id, other_project_id, other_site_id::text, outsider_id::text, position_id, current_date, null, 'Outsider'
from weekly_progress_smoke_ids
union all
select obsolete_actor_staff_id, project_id, site_id::text, obsolete_actor_id::text, position_id, current_date, null, 'Obsolete workflow actor'
from weekly_progress_smoke_ids;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select ids.obsolete_actor_id, permission.permission_code, 'project', ids.project_id, true
from weekly_progress_smoke_ids ids
cross join unnest(array[
  'project.weekly_progress.view',
  'project.weekly_progress.submit',
  'project.weekly_progress.verify',
  'project.weekly_progress.approve'
]::text[]) permission(permission_code);

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select project_id, site_id::text, 'weekly_progress', viewer_staff_id, true from weekly_progress_smoke_ids
union all
select project_id, site_id::text, 'weekly_progress', editor_staff_id, true from weekly_progress_smoke_ids
union all
select project_id, site_id::text, 'weekly_progress', confirmer_staff_id, true from weekly_progress_smoke_ids;

insert into public.project_permission_room_member_actions (room_member_id, action_code, is_active)
select member.id, action.action_code, true
from public.project_permission_room_members member
join weekly_progress_smoke_ids ids on ids.viewer_staff_id = member.project_staff_id
cross join unnest(array['view']::text[]) action(action_code)
where member.room_code = 'weekly_progress'
union all
select member.id, action.action_code, true
from public.project_permission_room_members member
join weekly_progress_smoke_ids ids on ids.editor_staff_id = member.project_staff_id
cross join unnest(array['view', 'edit']::text[]) action(action_code)
where member.room_code = 'weekly_progress'
union all
select member.id, action.action_code, true
from public.project_permission_room_members member
join weekly_progress_smoke_ids ids on ids.confirmer_staff_id = member.project_staff_id
cross join unnest(array['view', 'confirm']::text[]) action(action_code)
where member.room_code = 'weekly_progress';

insert into public.project_tasks (
  id, project_id, construction_site_id, parent_id, name, start_date, end_date,
  duration, progress, is_milestone, sort_order
)
select parent_task_id, project_id, site_id::text, null, 'Weekly Progress Smoke Parent',
  date '2026-08-03', date '2026-08-31', 29, 0, false, 1
from weekly_progress_smoke_ids
union all
select task_id, project_id, site_id::text, parent_task_id, 'Weekly Progress Smoke Task',
  date '2026-08-03', date '2026-08-31', 29, 0, false, 2
from weekly_progress_smoke_ids
union all
select other_task_id, other_project_id, other_site_id::text, null, 'Weekly Progress Other Task',
  date '2026-08-03', date '2026-08-31', 29, 0, false, 1
from weekly_progress_smoke_ids;

-- A viewer sees an implicit open state but cannot save or see another scope.
set local role authenticated;
select set_config('request.jwt.claim.email', viewer_email, true),
       set_config('request.jwt.claim.sub', viewer_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', viewer_email, 'sub', viewer_id)::text, true)
from weekly_progress_smoke_ids;

do $$
declare
  ids weekly_progress_smoke_ids%rowtype;
  v_state jsonb;
begin
  select * into ids from weekly_progress_smoke_ids;
  v_state := public.get_project_progress_period_state(
    ids.project_id, ids.site_id::text, 'daily', date '2026-08-05'
  );
  if coalesce((v_state ->> 'isLocked')::boolean, true) then
    raise exception 'a period without a state row must read as open';
  end if;

  begin
    perform public.get_project_progress_period_state(
      ids.other_project_id, ids.other_site_id::text, 'daily', date '2026-08-05'
    );
    raise exception 'viewer read leaked into another project/site';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.save_project_progress_period(
      ids.project_id, ids.site_id::text, 'daily', date '2026-08-05',
      jsonb_build_array(jsonb_build_object(
        'taskId', ids.task_id, 'progressPercent', 10, 'quantityDone', 1,
        'dailyQuantityDone', 1, 'attachments', '[]'::jsonb
      )),
      jsonb_build_object(
        'constructionProgressPercent', 10, 'valueProgressPercent', 5,
        'progressMode', 'daily_report'
      )
    );
    raise exception 'viewer unexpectedly saved progress';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Legacy submit/verify/approve grants do not imply the new confirm action.
set local role authenticated;
select set_config('request.jwt.claim.email', obsolete_actor_email, true),
       set_config('request.jwt.claim.sub', obsolete_actor_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', obsolete_actor_email, 'sub', obsolete_actor_id)::text, true)
from weekly_progress_smoke_ids;

do $$
begin
  begin
    perform public.close_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-09', null, null
    );
    raise exception 'obsolete weekly progress grants unexpectedly authorized confirm';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- An editor can save open daily and weekly periods, but cannot close them.
set local role authenticated;
select set_config('request.jwt.claim.email', editor_email, true),
       set_config('request.jwt.claim.sub', editor_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', editor_email, 'sub', editor_id)::text, true)
from weekly_progress_smoke_ids;

select public.save_project_progress_period(
  project_id, site_id::text, 'daily', date '2026-08-05',
  jsonb_build_array(jsonb_build_object(
    'taskId', task_id, 'progressPercent', 10, 'quantityDone', 1,
    'dailyQuantityDone', 1, 'note', 'daily open save', 'attachments', '[]'::jsonb
  )),
  jsonb_build_object(
    'constructionProgressPercent', 10, 'valueProgressPercent', 5,
    'progressMode', 'daily_report', 'purchasedValue', 100,
    'issuedValue', 50, 'recognizedValue', 40
  )
)
from weekly_progress_smoke_ids;

select public.save_project_progress_period(
  project_id, site_id::text, 'weekly', date '2026-08-03',
  jsonb_build_array(jsonb_build_object(
    'taskId', task_id, 'progressPercent', 20, 'quantityDone', 2,
    'note', 'weekly open save', 'attachments', '[]'::jsonb
  )),
  jsonb_build_object(
    'constructionProgressPercent', 20, 'valueProgressPercent', 10,
    'progressMode', 'weekly_report', 'purchasedValue', 200,
    'issuedValue', 100, 'recognizedValue', 80
  )
)
from weekly_progress_smoke_ids;

do $$
begin
  begin
    perform public.close_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-05', null, null
    );
    raise exception 'editor unexpectedly closed a period';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.project_daily_task_progress (
      scope_key, project_id, construction_site_id, task_id, progress_date, week_start
    )
    select project_id || '_' || site_id::text, project_id, site_id::text,
      task_id, date '2026-08-06', date '2026-08-03'
    from weekly_progress_smoke_ids;
    raise exception 'authenticated direct daily progress INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- A confirmer can transition state but cannot change progress without edit.
set local role authenticated;
select set_config('request.jwt.claim.email', confirmer_email, true),
       set_config('request.jwt.claim.sub', confirmer_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', confirmer_email, 'sub', confirmer_id)::text, true)
from weekly_progress_smoke_ids;

select public.close_project_progress_period(
  project_id, site_id::text, 'daily', date '2026-08-05', null, null
)
from weekly_progress_smoke_ids;

do $$
begin
  begin
    perform public.close_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-05', null, null
    );
    raise exception 'repeated close unexpectedly succeeded';
  exception when check_violation then null;
  end;

  if not (
    public.get_project_progress_period_state(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-05'
    ) ->> 'isLocked'
  )::boolean then
    raise exception 'daily period did not lock';
  end if;

  if (
    public.get_project_progress_period_state(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'weekly', date '2026-08-03'
    ) ->> 'isLocked'
  )::boolean then
    raise exception 'daily close implicitly locked its week';
  end if;

  begin
    perform public.save_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-06',
      jsonb_build_array(jsonb_build_object(
        'taskId', (select task_id from weekly_progress_smoke_ids),
        'progressPercent', 30, 'quantityDone', 3,
        'dailyQuantityDone', 1, 'attachments', '[]'::jsonb
      )),
      jsonb_build_object(
        'constructionProgressPercent', 30, 'valueProgressPercent', 15,
        'progressMode', 'daily_report'
      )
    );
    raise exception 'confirmer without edit unexpectedly changed data';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.reopen_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-05', '   '
    );
    raise exception 'blank reopen reason unexpectedly succeeded';
  exception when check_violation then null;
  end;
end $$;

select public.reopen_project_progress_period(
  project_id, site_id::text, 'daily', date '2026-08-05', 'Điều chỉnh số liệu nghiệm thu'
)
from weekly_progress_smoke_ids;

do $$
begin
  begin
    perform public.reopen_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-05', 'Repeated reopen must fail'
    );
    raise exception 'repeated reopen unexpectedly succeeded';
  exception when check_violation then null;
  end;

  if (
    select count(*)
    from public.permission_audit_events event
    join weekly_progress_smoke_ids ids on event.actor_user_id = ids.confirmer_id
    where event.event_type = 'weekly_progress_period_locked'
      and event.metadata ->> 'project_id' = ids.project_id
      and event.metadata ->> 'construction_site_id' = ids.site_id::text
      and event.metadata ->> 'period_type' = 'daily'
      and event.metadata ->> 'period_start' = '2026-08-05'
  ) <> 1 or (
    select count(*)
    from public.permission_audit_events event
    join weekly_progress_smoke_ids ids on event.actor_user_id = ids.confirmer_id
    where event.event_type = 'weekly_progress_period_unlocked'
      and event.metadata ->> 'project_id' = ids.project_id
      and event.metadata ->> 'construction_site_id' = ids.site_id::text
      and event.metadata ->> 'period_type' = 'daily'
      and event.metadata ->> 'period_start' = '2026-08-05'
  ) <> 1 then
    raise exception 'repeated close/reopen emitted duplicate audit events';
  end if;
end $$;

select public.close_project_progress_period(
  project_id, site_id::text, 'weekly', date '2026-08-03', null, null
)
from weekly_progress_smoke_ids;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.project_tasks task
    join weekly_progress_smoke_ids ids on task.id = ids.parent_task_id
    where task.progress = 20
      and task.progress_mode = 'children_auto'
  ) then
    raise exception 'weekly save did not update derived parent task progress';
  end if;
end $$;

create temp table weekly_progress_frozen_values on commit drop as
select to_jsonb(weekly) as weekly_row, to_jsonb(snapshot) as snapshot_row
from weekly_progress_smoke_ids ids
join public.project_weekly_task_progress weekly
  on weekly.scope_key = ids.project_id || '_' || ids.site_id::text
  and weekly.task_id = ids.task_id
  and weekly.week_start = date '2026-08-03'
join public.weekly_progress_snapshots snapshot
  on snapshot.scope_key = ids.project_id || '_' || ids.site_id::text
  and snapshot.week_start = date '2026-08-03';

grant select on weekly_progress_frozen_values to authenticated;

-- Daily edits remain possible under a weekly lock, while weekly aggregate and snapshot stay frozen.
set local role authenticated;
select set_config('request.jwt.claim.email', editor_email, true),
       set_config('request.jwt.claim.sub', editor_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', editor_email, 'sub', editor_id)::text, true)
from weekly_progress_smoke_ids;

-- Friday is authoritative current progress even when Wednesday is edited later.
select public.save_project_progress_period(
  project_id, site_id::text, 'daily', date '2026-08-07',
  jsonb_build_array(jsonb_build_object(
    'taskId', task_id, 'progressPercent', 60, 'quantityDone', 6,
    'dailyQuantityDone', 2, 'attachments', '[]'::jsonb
  )),
  jsonb_build_object(
    'constructionProgressPercent', 60, 'valueProgressPercent', 30,
    'progressMode', 'daily_report', 'purchasedValue', 600
  )
)
from weekly_progress_smoke_ids;

select public.save_project_progress_period(
  project_id, site_id::text, 'daily', date '2026-08-06',
  jsonb_build_array(jsonb_build_object(
    'taskId', task_id, 'progressPercent', 40, 'quantityDone', 4,
    'dailyQuantityDone', 3, 'attachments', '[]'::jsonb
  )),
  jsonb_build_object(
    'constructionProgressPercent', 40, 'valueProgressPercent', 20,
    'progressMode', 'daily_report', 'purchasedValue', 400
  )
)
from weekly_progress_smoke_ids;

do $$
begin
  if exists (
    select 1
    from weekly_progress_smoke_ids ids
    join public.project_weekly_task_progress weekly
      on weekly.scope_key = ids.project_id || '_' || ids.site_id::text
      and weekly.task_id = ids.task_id
      and weekly.week_start = date '2026-08-03'
    cross join weekly_progress_frozen_values frozen
    where to_jsonb(weekly) is distinct from frozen.weekly_row
  ) or exists (
    select 1
    from weekly_progress_smoke_ids ids
    join public.weekly_progress_snapshots snapshot
      on snapshot.scope_key = ids.project_id || '_' || ids.site_id::text
      and snapshot.week_start = date '2026-08-03'
    cross join weekly_progress_frozen_values frozen
    where to_jsonb(snapshot) is distinct from frozen.snapshot_row
  ) then
    raise exception 'daily save mutated a locked weekly aggregate or snapshot';
  end if;

  if not exists (
    select 1
    from public.project_tasks task
    join weekly_progress_smoke_ids ids on task.id in (ids.task_id, ids.parent_task_id)
    where task.progress = 60
    group by ids.task_id
    having count(*) = 2
  ) then
    raise exception 'out-of-order daily edit regressed current leaf or derived parent progress';
  end if;

  begin
    perform public.save_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'daily', date '2026-08-08',
      jsonb_build_array(jsonb_build_object(
        'taskId', (select parent_task_id from weekly_progress_smoke_ids),
        'progressPercent', 70, 'quantityDone', 7,
        'dailyQuantityDone', 1, 'attachments', '[]'::jsonb
      )),
      jsonb_build_object(
        'constructionProgressPercent', 70, 'valueProgressPercent', 35,
        'progressMode', 'daily_report'
      )
    );
    raise exception 'derived parent task unexpectedly accepted in progress payload';
  exception when check_violation then null;
  end;

  begin
    perform public.save_project_progress_period(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      'weekly', date '2026-08-03',
      jsonb_build_array(jsonb_build_object(
        'taskId', (select task_id from weekly_progress_smoke_ids),
        'progressPercent', 50, 'quantityDone', 5, 'attachments', '[]'::jsonb
      )),
      jsonb_build_object(
        'constructionProgressPercent', 50, 'valueProgressPercent', 25,
        'progressMode', 'weekly_report'
      )
    );
    raise exception 'editor changed a locked weekly period';
  exception when check_violation then null;
  end;

end $$;

reset role;

-- Opening Balance retry is bound to its server-owned balance identity and
-- still honors the weekly period lock without weekly_progress Room membership.
set local role authenticated;
select set_config('request.jwt.claim.email', keeper_email, true),
       set_config('request.jwt.claim.sub', keeper_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', keeper_email, 'sub', keeper_id)::text, true)
from weekly_progress_smoke_ids;

do $$
declare
  v_retry jsonb;
begin
  if public.project_user_has_room_action(
    (select project_id from weekly_progress_smoke_ids),
    (select site_id::text from weekly_progress_smoke_ids),
    'weekly_progress', 'edit',
    (select keeper_id from weekly_progress_smoke_ids)
  ) then
    raise exception 'global keeper unexpectedly has weekly_progress Room membership';
  end if;

  begin
    perform public.preflight_project_progress_snapshot(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      date '2026-08-03',
      jsonb_build_object(
        'constructionProgressPercent', 41, 'valueProgressPercent', 21,
        'progressMode', 'opening_balance'
      )
    );
    raise exception 'snapshot preflight allowed a locked weekly period';
  exception when check_violation then null;
  end;

  v_retry := public.get_project_opening_balance_snapshot_retry(
    (select opening_balance_id from weekly_progress_smoke_ids)
  );
  if v_retry ->> 'status' <> 'pending'
    or not coalesce((v_retry ->> 'canRetry')::boolean, false)
    or v_retry ->> 'scopeKey' <> (
      select project_id || '_' || site_id::text from weekly_progress_smoke_ids
    )
    or v_retry ->> 'weekStart' <> '2026-08-03' then
    raise exception 'legacy Opening Balance retry state was not canonicalized by identity';
  end if;

  begin
    perform public.refresh_project_progress_snapshot(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      date '2026-08-03',
      jsonb_build_object(
        'constructionProgressPercent', 41, 'valueProgressPercent', 21,
        'progressMode', 'opening_balance'
      )
    );
    raise exception 'unbound snapshot refresh unexpectedly remained executable';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.project_opening_balances
    set progress_snapshot_payload = jsonb_build_object('attacker', true)
    where id = (select opening_balance_id from weekly_progress_smoke_ids);
    raise exception 'direct retry metadata update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.sync_project_opening_balance_snapshot(
      (select opening_balance_id from weekly_progress_smoke_ids)
    );
    raise exception 'bound Opening Balance sync changed a locked weekly period';
  exception when check_violation then null;
  end;
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.email', confirmer_email, true),
       set_config('request.jwt.claim.sub', confirmer_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', confirmer_email, 'sub', confirmer_id)::text, true)
from weekly_progress_smoke_ids;

select public.reopen_project_progress_period(
  project_id, site_id::text, 'weekly', date '2026-08-03', 'Refresh Opening Balance snapshot'
)
from weekly_progress_smoke_ids;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.email', editor_email, true),
       set_config('request.jwt.claim.sub', editor_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', editor_email, 'sub', editor_id)::text, true)
from weekly_progress_smoke_ids;

do $$
begin
  begin
    perform public.preflight_project_progress_snapshot(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      date '2026-08-03',
      jsonb_build_object(
        'constructionProgressPercent', 41, 'valueProgressPercent', 21,
        'progressMode', 'opening_balance'
      )
    );
    raise exception 'weekly_progress editor unexpectedly received Opening Balance preflight authority';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.refresh_project_progress_snapshot(
      (select project_id from weekly_progress_smoke_ids),
      (select site_id::text from weekly_progress_smoke_ids),
      date '2026-08-03',
      jsonb_build_object(
        'constructionProgressPercent', 41, 'valueProgressPercent', 21,
        'progressMode', 'opening_balance'
      )
    );
    raise exception 'weekly_progress editor unexpectedly received unbound Opening Balance authority';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.get_project_opening_balance_snapshot_retry(
      (select opening_balance_id from weekly_progress_smoke_ids)
    );
    raise exception 'weekly_progress editor unexpectedly read Opening Balance retry state';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.prepare_project_opening_balance_snapshot(
      (select opening_balance_id from weekly_progress_smoke_ids)
    );
    raise exception 'weekly_progress editor unexpectedly prepared Opening Balance retry state';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.sync_project_opening_balance_snapshot(
      (select opening_balance_id from weekly_progress_smoke_ids)
    );
    raise exception 'weekly_progress editor unexpectedly synchronized Opening Balance retry state';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.email', keeper_email, true),
       set_config('request.jwt.claim.sub', keeper_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', keeper_email, 'sub', keeper_id)::text, true)
from weekly_progress_smoke_ids;

do $$
declare
  ids weekly_progress_smoke_ids%rowtype;
  v_result jsonb;
begin
  select * into ids from weekly_progress_smoke_ids;
  v_result := public.preflight_project_progress_snapshot(
    ids.project_id, ids.site_id::text, date '2026-08-10',
    jsonb_build_object(
      'constructionProgressPercent', 42, 'valueProgressPercent', 22,
      'progressMode', 'opening_balance', 'recognizedValue', 420
    )
  );
  if not coalesce((v_result ->> 'allowed')::boolean, false) then
    raise exception 'Opening Balance preflight did not authorize the global keeper';
  end if;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.scope_key = ids.project_id || '_' || ids.site_id::text
      and state.period_type = 'weekly'
      and state.period_start = date '2026-08-10'
  ) or exists (
    select 1 from public.weekly_progress_snapshots snapshot
    where snapshot.scope_key = ids.project_id || '_' || ids.site_id::text
      and snapshot.week_start = date '2026-08-10'
  ) then
    raise exception 'Opening Balance preflight mutated period or snapshot data';
  end if;
end $$;

select public.sync_project_opening_balance_snapshot(opening_balance_id)
from weekly_progress_smoke_ids;

do $$
begin
  if not exists (
    select 1
    from public.weekly_progress_snapshots snapshot
    join weekly_progress_smoke_ids ids
      on snapshot.scope_key = ids.project_id || '_' || ids.site_id::text
    where snapshot.week_start = date '2026-08-03'
      and snapshot.progress_percent = 41
      and snapshot.value_progress_percent = 21
      and snapshot.progress_mode = 'opening_balance'
  ) then
    raise exception 'Opening Balance snapshot refresh did not persist after reopen';
  end if;
end $$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.project_opening_balances balance
    join weekly_progress_smoke_ids ids on ids.opening_balance_id = balance.id
    where balance.progress_snapshot_status <> 'synced'
      or balance.progress_snapshot_refreshed_at is null
      or balance.progress_snapshot_payload ?| array['projectId', 'constructionSiteId', 'weekStart']
      or balance.progress_snapshot_payload ->> 'progressMode' <> 'opening_balance'
      or (balance.progress_snapshot_payload ->> 'constructionProgressPercent')::numeric <> 41
  ) then
    raise exception 'legacy mismatched retry payload escaped canonical opening balance binding';
  end if;
end $$;

-- System Admin is an operational override, not a Room recipient. Scope/task mismatch still fails.
set local role authenticated;
select set_config('request.jwt.claim.email', admin_email, true),
       set_config('request.jwt.claim.sub', admin_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', admin_email, 'sub', admin_id)::text, true)
from weekly_progress_smoke_ids;

do $$
declare
  ids weekly_progress_smoke_ids%rowtype;
begin
  select * into ids from weekly_progress_smoke_ids;
  if public.project_user_has_room_action(
    ids.other_project_id, ids.other_site_id::text, 'weekly_progress', 'edit', ids.admin_id
  ) then
    raise exception 'System Admin was added as a weekly_progress Room recipient';
  end if;

  begin
    perform public.get_project_progress_period_state(
      ids.project_id, ids.other_site_id::text, 'daily', date '2026-08-07'
    );
    raise exception 'same-project wrong-site scope unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    perform public.save_project_progress_period(
      ids.other_project_id, ids.other_site_id::text, 'daily', date '2026-08-07',
      jsonb_build_array(jsonb_build_object(
        'taskId', ids.task_id, 'progressPercent', 60, 'quantityDone', 6,
        'dailyQuantityDone', 6, 'attachments', '[]'::jsonb
      )),
      jsonb_build_object(
        'constructionProgressPercent', 60, 'valueProgressPercent', 30,
        'progressMode', 'daily_report'
      )
    );
    raise exception 'task from another project/site was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.get_project_progress_period_state(
      ids.other_project_id, ids.other_site_id::text, 'weekly', date '2026-08-04'
    );
    raise exception 'non-Monday weekly periodStart unexpectedly succeeded';
  exception when check_violation then null;
  end;
end $$;

select public.close_project_progress_period(
  other_project_id, other_site_id::text, 'weekly', date '2026-08-03',
  jsonb_build_array(jsonb_build_object(
    'taskId', other_task_id, 'progressPercent', 15, 'quantityDone', 1,
    'attachments', '[]'::jsonb
  )),
  jsonb_build_object(
    'constructionProgressPercent', 15, 'valueProgressPercent', 5,
    'progressMode', 'weekly_report'
  )
)
from weekly_progress_smoke_ids;

select public.reopen_project_progress_period(
  other_project_id, other_site_id::text, 'weekly', date '2026-08-03', 'System Admin correction'
)
from weekly_progress_smoke_ids;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.email', viewer_email, true),
       set_config('request.jwt.claim.sub', viewer_id::text, true),
       set_config('request.jwt.claims', jsonb_build_object('email', viewer_email, 'sub', viewer_id)::text, true)
from weekly_progress_smoke_ids;

do $$
begin
  if not exists (
    select 1
    from public.project_weekly_task_progress weekly
    where weekly.project_id = (select project_id from weekly_progress_smoke_ids)
  ) then
    raise exception 'viewer could not read authorized weekly progress';
  end if;

  if exists (
    select 1
    from public.project_weekly_task_progress weekly
    where weekly.project_id = (select other_project_id from weekly_progress_smoke_ids)
  ) then
    raise exception 'weekly progress RLS leaked another project/site';
  end if;
end $$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.permission_audit_events event
    join weekly_progress_smoke_ids ids on event.actor_user_id = ids.confirmer_id
    where event.event_type = 'weekly_progress_period_unlocked'
      and event.metadata ->> 'project_id' = ids.project_id
      and event.metadata ->> 'construction_site_id' = ids.site_id::text
      and event.metadata ->> 'period_type' = 'daily'
      and event.metadata ->> 'period_start' = '2026-08-05'
      and event.metadata ->> 'reason' = 'Điều chỉnh số liệu nghiệm thu'
  ) then
    raise exception 'reopen audit event omitted actor, scope, period, or reason';
  end if;
end $$;

rollback;
