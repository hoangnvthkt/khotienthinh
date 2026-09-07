begin;

create temporary table work_core_personas (
  name text primary key, user_id uuid, auth_id uuid, email text,
  expected_standard boolean, expected_restricted boolean
) on commit drop;
create temporary table work_core_tasks (name text primary key, id uuid) on commit drop;
grant select on work_core_personas, work_core_tasks to authenticated;

do $$
declare
  v_persona record;
  v_creator uuid;
  v_department uuid := gen_random_uuid();
  v_other_department uuid := gen_random_uuid();
  v_project text := 'work-core-' || gen_random_uuid()::text;
  v_task uuid;
  v_group uuid;
  v_rejected boolean;
begin
  insert into work_core_personas
  select name, gen_random_uuid(), gen_random_uuid(),
    'work-core-' || gen_random_uuid()::text || '@invalid.local', standard, restricted
  from (values
    ('creator', true, true), ('assignee', true, true), ('watcher', true, true),
    ('reviewer', true, true), ('manager', true, false), ('unrelated', false, false),
    ('inactive', false, false), ('restricted_manager', true, true),
    ('technical_admin', false, false), ('scoped_watcher', true, true)
  ) p(name, standard, restricted);
  insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, name, 'work-core-' || user_id::text, email,
    case when name = 'technical_admin' then 'ADMIN' else 'EMPLOYEE' end::public.user_role,
    name <> 'inactive', case when name = 'inactive' then 'DISABLED' else 'ACTIVE' end
  from work_core_personas;
  select user_id into v_creator from work_core_personas where name = 'creator';
  insert into public.org_units(id, name) values
    (v_department, 'Work Core Department'), (v_other_department, 'Work Other Department');
  insert into public.projects(id, code, name) values (v_project, v_project, 'Work Core Project');
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.module.access', 'global', '*', 'rollback smoke'
  from work_core_personas where name not in ('technical_admin', 'inactive');
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.task.view_related',
    case when name = 'creator' then 'own' else 'assigned' end, '*', 'rollback smoke'
  from work_core_personas where name in ('creator','assignee','watcher','reviewer');
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.task.view_related', 'department', v_department::text, 'rollback smoke'
  from work_core_personas where name = 'scoped_watcher';
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.task.view_scope', 'department', v_department::text, 'rollback smoke'
  from work_core_personas where name in ('manager','restricted_manager');
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.task.audit_view', 'department', v_department::text, 'rollback smoke'
  from work_core_personas where name = 'manager';
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'work.task.audit_view', 'assigned', '*', 'rollback smoke'
  from work_core_personas where name = 'restricted_manager';
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason, expires_at)
  select user_id, 'work.task.view_restricted', 'department', v_department::text, 'rollback smoke', now() + interval '1 day'
  from work_core_personas where name = 'restricted_manager';
  insert into public.work_task_groups(name, scope_type, department_id, created_by)
  values ('Work Core Bucket', 'department', v_department, v_creator) returning id into v_group;

  for v_persona in select unnest(array['standard','restricted']) as name loop
    insert into public.work_tasks(task_code, title, scope_type, department_id, task_group_id, privacy, created_by)
    values (app_private.next_work_task_code(), v_persona.name, 'department', v_department, v_group,
      v_persona.name, v_creator) returning id into v_task;
    insert into work_core_tasks values (v_persona.name, v_task);
    insert into public.work_task_assignments(task_id, user_id, assigned_by)
    select v_task, user_id, v_creator from work_core_personas where name in ('assignee','inactive');
    insert into public.work_task_participants(task_id, user_id, participant_role, added_by)
    select v_task, user_id, name, v_creator from work_core_personas where name in ('watcher','reviewer');
    insert into public.work_task_participants(task_id, user_id, participant_role, added_by)
    select v_task, user_id, 'watcher', v_creator from work_core_personas where name = 'scoped_watcher';
    insert into public.work_task_events(task_id, event_type, actor_user_id)
    values (v_task, 'task_created', v_creator);
    insert into public.work_task_versions(task_id, version, snapshot, actor_user_id)
    values (v_task, 1, '{}', v_creator);
  end loop;

  insert into public.work_tasks(task_code, title, scope_type, project_id, created_by)
  values (app_private.next_work_task_code(), 'Project isolation', 'project', v_project, v_creator);
  insert into public.work_tasks(task_code, title, scope_type, department_id, created_by)
  values (app_private.next_work_task_code(), 'Department isolation', 'department', v_other_department, v_creator);

  v_rejected := false;
  begin
    insert into public.work_tasks(task_code, title, scope_type, project_id, department_id, created_by)
    values (app_private.next_work_task_code(), 'Invalid scope', 'project', v_project, v_department, v_creator);
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'WORK_SCOPE_SHAPE_NOT_ENFORCED'; end if;

  v_rejected := false;
  begin
    insert into public.work_tasks(task_code, title, scope_type, project_id, task_group_id, created_by)
    values (app_private.next_work_task_code(), 'Wrong bucket', 'project', v_project, v_group, v_creator);
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'WORK_BUCKET_SCOPE_NOT_ENFORCED'; end if;

  v_rejected := false;
  begin
    insert into public.work_task_assignments(task_id, user_id, assigned_by)
    select v_task, user_id, v_creator from work_core_personas where name = 'assignee';
  exception when unique_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'WORK_DUPLICATE_ASSIGNMENT_ALLOWED'; end if;
end;
$$;

set local role authenticated;
do $$
declare
  v_persona record;
  v_task record;
  v_visible boolean;
  v_count integer;
  v_rejected boolean;
begin
  for v_persona in select * from work_core_personas loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_persona.auth_id, 'email', v_persona.email, 'role', 'authenticated'
    )::text, true);
    for v_task in select * from work_core_tasks loop
      select exists(select 1 from public.work_tasks where id = v_task.id) into v_visible;
      if v_visible is distinct from (case when v_task.name = 'standard'
        then v_persona.expected_standard else v_persona.expected_restricted end) then
        raise exception 'WORK_RLS_MATRIX_FAILED persona=% task=% visible=%', v_persona.name, v_task.name, v_visible;
      end if;
      select exists(select 1 from public.work_task_versions where task_id = v_task.id) into v_visible;
      if v_visible is distinct from (v_persona.name = 'manager' and v_task.name = 'standard') then
        raise exception 'WORK_AUDIT_SCOPE_FAILED persona=% task=%', v_persona.name, v_task.name;
      end if;
    end loop;
    if v_persona.name = 'manager' then
      select count(*) into v_count from public.work_tasks;
      if v_count <> 1 then raise exception 'WORK_SCOPE_LEAK count=%', v_count; end if;
    end if;
    v_rejected := false;
    begin
      update public.work_tasks set title = 'Unauthorized overwrite' where id in (select id from work_core_tasks);
    exception when insufficient_privilege then v_rejected := true;
    end;
    if not v_rejected then raise exception 'WORK_DIRECT_UPDATE_PRIVILEGE'; end if;
  end loop;
end;
$$;
reset role;

do $$
begin
  if has_table_privilege('anon', 'public.work_tasks', 'SELECT') then
    raise exception 'WORK_ANON_TABLE_ACCESS';
  end if;
  if has_table_privilege('authenticated', 'app_private.work_notification_outbox', 'SELECT') then
    raise exception 'WORK_OUTBOX_EXPOSED';
  end if;
end;
$$;

do $$
declare
  v_rejected boolean := false;
  v_year integer := extract(year from timezone('Asia/Ho_Chi_Minh', now()))::integer;
  v_code text;
begin
  insert into app_private.work_task_code_counters(code_year, last_sequence)
  values (v_year, 999999)
  on conflict (code_year) do update set last_sequence = 999999;
  v_code := app_private.next_work_task_code();
  if v_code <> 'VW-' || v_year::text || '-1000000' then
    raise exception 'WORK_CODE_COUNTER_TRUNCATED code=%', v_code;
  end if;
  begin
    update public.work_tasks set task_code = 'VW-2099-999999'
    where id = (select id from work_core_tasks where name = 'standard');
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'WORK_TASK_CODE_MUTABLE'; end if;

  v_rejected := false;
  begin
    update public.work_task_events set payload = '{"rewritten":true}'
    where task_id = (select id from work_core_tasks where name = 'standard');
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'WORK_AUDIT_NOT_APPEND_ONLY'; end if;
end;
$$;
-- These operations run as the migration owner: integrity must not rely only on
-- browser grants. An RPC implementation mistake must not corrupt task history.
do $$
declare
  v_task uuid := (select id from work_core_tasks where name = 'standard');
  v_other uuid := (select id from work_core_tasks where name = 'restricted');
  v_actor uuid := (select user_id from work_core_personas where name = 'creator');
  v_comment uuid;
  v_assignment uuid;
  v_case record;
  v_rejected boolean;
begin
  insert into public.work_task_comments(task_id, author_user_id, content_document, content_text)
  values (v_other, v_actor, '{"version":1}', 'Private comment') returning id into v_comment;
  select id into v_assignment from public.work_task_assignments where task_id = v_other limit 1;
  insert into public.work_task_submissions(task_id, iteration, submitted_by)
  values (v_task, 1, v_actor);
  for v_case in select * from (values
    ('event delete', format('delete from public.work_task_events where task_id=%L', v_task)),
    ('version update', format('update public.work_task_versions set snapshot=''{}'' where task_id=%L', v_task)),
    ('version delete', format('delete from public.work_task_versions where task_id=%L', v_task)),
    ('assignment delete', format('delete from public.work_task_assignments where task_id=%L', v_task)),
    ('submission delete', format('delete from public.work_task_submissions where task_id=%L', v_task)),
    ('cross-task reply', format('insert into public.work_task_comments(task_id,author_user_id,parent_comment_id,content_document,content_text) values(%L,%L,%L,''{}'',''Reply'')', v_task,v_actor,v_comment)),
    ('cross-task mention', format('insert into public.work_task_mentions(task_id,comment_id,mentioned_user_id,mentioned_by) values(%L,%L,%L,%L)', v_task,v_comment,v_actor,v_actor)),
    ('cross-task transfer', format('update public.work_task_assignments set transfer_from_assignment_id=%L where task_id=%L', v_assignment,v_task)),
    ('bucket scope rewrite', format('update public.work_task_groups set department_id=(select department_id from public.work_tasks where title=''Department isolation'') where id=(select task_group_id from public.work_tasks where id=%L)', v_task))
  ) cases(label, statement) loop
    v_rejected := false;
    begin
      execute v_case.statement;
    exception when check_violation or foreign_key_violation then v_rejected := true;
    end;
    if not v_rejected then raise exception 'WORK_INTEGRITY_NOT_ENFORCED: %', v_case.label; end if;
  end loop;
end;
$$;
do $$
declare v_missing text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ')
  into v_missing
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and t.relname like 'work\_%' escape '\'
    and n.nspname in ('public', 'app_private')
    and not exists (
      select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
        and i.indkey[0] = c.conkey[1]
        and (i.indpred is null or pg_get_expr(i.indpred, i.indrelid) = format('(%I IS NOT NULL)', a.attname))
    );
  if v_missing is not null then raise exception 'WORK_FK_INDEX_MISSING: %', v_missing; end if;

  select string_agg(n.nspname || '.' || c.relname, ', ') into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relname like 'work\_%' escape '\' and c.relkind = 'r'
    and n.nspname in ('public','app_private') and not c.relrowsecurity;
  if v_missing is not null then raise exception 'WORK_RLS_MISSING: %', v_missing; end if;
end;
$$;
select jsonb_build_object('personas', 10, 'rls', 'ok', 'constraints', 'ok', 'transaction', 'rollback') as work_core_smoke;
rollback;
