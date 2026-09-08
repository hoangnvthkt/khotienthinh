-- WS4 candidate smoke.  Run in a transaction: every row below is synthetic and
-- is rolled back at the end.  This intentionally fails before the WS4 migration
-- when the workspace scope resolver or list RPC has not been installed yet.
begin;

do $$
declare
  v_missing text;
begin
  select string_agg(required.signature, ', ' order by required.signature)
    into v_missing
  from (values
    ('app_private.work_resolve_workspace_scope(jsonb)'),
    ('public.list_work_workspace_tasks(uuid,jsonb,jsonb,integer)'),
    ('public.get_work_task_detail(text)'),
    ('public.list_work_task_comments(uuid,jsonb,integer)'),
    ('public.list_work_task_history(uuid,jsonb,jsonb,integer)'),
    ('public.get_work_clone_form(uuid)'),
    ('public.command_work_task(uuid,text,jsonb,bigint,uuid)'),
    ('public.command_work_attachment(text,jsonb,uuid)'),
    ('public.list_work_tasks(text,jsonb,jsonb,integer)')
  ) required(signature)
  where to_regprocedure(required.signature) is null;

  if v_missing is not null then
    raise exception 'WORKSPACE_TASK_ACCESS_MISSING: %', v_missing
      using errcode = '42883';
  end if;
end;
$$;

create temp table ws4_people (
  name text primary key,
  user_id uuid not null,
  auth_id uuid,
  email text not null
) on commit drop;
create temp table ws4_data (
  key text primary key,
  value jsonb not null
) on commit drop;
grant select on ws4_people, ws4_data to authenticated;
grant insert, update on ws4_data to authenticated;
grant select on ws4_data to service_role;

-- Synthetic users use the email fallback only when no auth identity exists.  If
-- a fixture is changed to use a real public.users.auth_id, ws4_as uses that
-- auth_id as the JWT subject instead of inventing a different subject.
insert into ws4_people(name, user_id, auth_id, email)
select name, gen_random_uuid(), null,
  'ws4-' || gen_random_uuid()::text || '@invalid.local'
from unnest(array[
  'admin', 'member', 'restricted_member', 'restricted_viewer', 'former_assignee', 'outsider'
]) as people(name);

insert into public.users(
  id, name, username, email, role, is_active, account_status, allowed_modules
)
select user_id, 'WS4 ' || name, 'ws4-' || user_id::text, email,
  'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[]
from ws4_people;

-- The outsider deliberately has a broad legacy scope grant.  It must not grant
-- access to a Workspace task after the WS4 bridge is installed.
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, 'work.module.access', 'global', '*', 'WS4 rollback smoke', now() + interval '1 day'
from ws4_people;
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, 'work.task.view_related', 'assigned', '*', 'WS4 rollback smoke', now() + interval '1 day'
from ws4_people
where name in ('member', 'former_assignee');
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, 'work.task.view_related', 'own', '*', 'WS4 rollback smoke', now() + interval '1 day'
from ws4_people
where name = 'admin';
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, 'work.task.view_scope', 'global', '*', 'WS4 outsider legacy grant', now() + interval '1 day'
from ws4_people
where name = 'outsider';
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, 'work.task.audit_view', 'assigned', '*', 'WS4 rollback smoke', now() + interval '1 day'
from ws4_people
where name = 'former_assignee';
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select user_id, permission_code, 'global', '*', 'WS4 direct-task regression', now() + interval '1 day'
from ws4_people
cross join unnest(array['work.task.create', 'work.task.view_related']) as permissions(permission_code)
where name = 'admin';

with source_rows as (
  insert into public.org_units(name)
  values ('WS4 legacy department')
  returning id
)
insert into ws4_data(key, value)
select 'department', to_jsonb(id) from source_rows;

with source_rows as (
  insert into public.projects(id, code, name, status)
  values (
    'ws4-project-' || gen_random_uuid()::text,
    'WS4-' || gen_random_uuid()::text,
    'WS4 legacy project',
    'active'
  )
  returning id
)
insert into ws4_data(key, value)
select 'project', to_jsonb(id) from source_rows;

-- The direct table inserts model the post-WS2 trusted command boundary.  The
-- browser role never receives table mutation privileges.
with workspace_rows as (
  insert into public.work_workspaces(
    kind, department_id, project_id, name, description, icon_key, color_key, cover_key,
    status, access_mode, created_by
  )
  values
    ('collaboration', null, null, 'WS4 collaboration workspace', 'WS4 rollback fixture', 'users', 'blue', 'grid', 'active', 'workspace',
      (select user_id from ws4_people where name = 'admin')),
    ('department', (select (value#>>'{}')::uuid from ws4_data where key = 'department'), null, 'WS4 department workspace', 'WS4 legacy department bridge', 'building', 'teal', 'plain', 'active', 'workspace',
      (select user_id from ws4_people where name = 'admin')),
    ('project', null, (select value#>>'{}' from ws4_data where key = 'project'), 'WS4 project workspace', 'WS4 legacy project bridge', 'briefcase', 'violet', 'plain', 'active', 'workspace',
      (select user_id from ws4_people where name = 'admin')),
    ('collaboration', null, null, 'WS4 archived workspace', 'WS4 archived read-only fixture', 'layers', 'slate', 'dots', 'active', 'workspace',
      (select user_id from ws4_people where name = 'admin'))
  returning id, kind, department_id, project_id, name
)
insert into ws4_data(key, value)
select case name
    when 'WS4 collaboration workspace' then 'workspace'
    when 'WS4 department workspace' then 'department_workspace'
    when 'WS4 project workspace' then 'project_workspace'
    else 'archived_workspace'
  end,
  jsonb_build_object('id', id, 'kind', kind, 'departmentId', department_id, 'projectId', project_id)
from workspace_rows;

-- Workspace membership is intentionally the only workspace-specific source for
-- member/restricted-member visibility.  Admin grants below only make the
-- trusted removal command callable; assert_member still requires membership.
insert into public.work_workspace_members(
  workspace_id, user_id, role, status, starts_at, added_by, origin
)
select w.workspace_id::uuid, p.user_id,
  case when p.name = 'admin' then 'admin' else 'member' end,
  'active', now() - interval '1 hour',
  (select user_id from ws4_people where name = 'admin'), 'manual'
from (
  select value->>'id' as workspace_id
  from ws4_data
  where key in ('workspace', 'department_workspace', 'project_workspace', 'archived_workspace')
) w
join ws4_people p on (
  p.name in ('admin', 'member')
  or (w.workspace_id = (select value->>'id' from ws4_data where key = 'workspace')
      and p.name in ('restricted_member', 'restricted_viewer', 'former_assignee'))
);

insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, grant_reason, expires_at
)
select (select user_id from ws4_people where name = 'admin'), permission_code,
  'work_workspace', value->>'id', 'WS4 trusted membership command', now() + interval '1 day'
from ws4_data
cross join unnest(array['work.workspace.manage_members', 'work.workspace.archive', 'work.task.configure']) as permissions(permission_code)
where key in ('workspace', 'department_workspace', 'project_workspace', 'archived_workspace');
insert into public.user_permission_grants(
  user_id,permission_code,scope_type,scope_id,grant_reason,expires_at
) select (select user_id from ws4_people where name='restricted_viewer'),
  'work.task.view_restricted','work_workspace',value->>'id','WS4 explicit restricted view',now()+interval '1 day'
from ws4_data where key='workspace';

with calendar_row as (
  insert into public.work_sla_calendars(
    name,working_weekdays,workday_start,workday_end,working_intervals,is_default,is_active,created_by
  ) values(
    'WS4 rollback calendar',array[1,2,3,4,5]::smallint[],'08:00','17:00',
    '[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]',false,true,
    (select user_id from ws4_people where name='admin')
  ) returning id
)
insert into ws4_data(key,value) select 'calendar',to_jsonb(id) from calendar_row;
insert into public.work_sla_policies(
  name,scope_type,department_id,calendar_id,acknowledgement_minutes,priority,created_by
) values(
  'WS4 rollback policy','department',(select (value#>>'{}')::uuid from ws4_data where key='department'),
  (select (value#>>'{}')::uuid from ws4_data where key='calendar'),480,'normal',
  (select user_id from ws4_people where name='admin')
);

-- Keep all task IDs/codes in a fixture-local table so checks never depend on
-- production identifiers or on the old assumption that Work has zero tasks.
with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 standard workspace task', '{"version":1,"type":"doc","content":[]}',
    'standard workspace task', 'workspace',
    (select (value->>'id')::uuid from ws4_data where key = 'workspace'),
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'standard_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 restricted unrelated task', '{"version":1,"type":"doc","content":[]}',
    'restricted workspace task', 'workspace',
    (select (value->>'id')::uuid from ws4_data where key = 'workspace'),
    'restricted', 'urgent', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'restricted_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 former assignee task', '{"version":1,"type":"doc","content":[]}',
    'former assignee workspace task', 'workspace',
    (select (value->>'id')::uuid from ws4_data where key = 'workspace'),
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'former_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    department_id, workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 legacy department mapped task', '{"version":1,"type":"doc","content":[]}',
    'legacy department task mapped to Workspace', 'department',
    (select (value#>>'{}')::uuid from ws4_data where key = 'department'),
    (select (value->>'id')::uuid from ws4_data where key = 'department_workspace'),
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'department_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    project_id, workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 legacy project mapped task', '{"version":1,"type":"doc","content":[]}',
    'legacy project task mapped to Workspace', 'project',
    (select value#>>'{}' from ws4_data where key = 'project'),
    (select (value->>'id')::uuid from ws4_data where key = 'project_workspace'),
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'project_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    workspace_id, privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 archived read-only task', '{"version":1,"type":"doc","content":[]}',
    'archived workspace task', 'workspace',
    (select (value->>'id')::uuid from ws4_data where key = 'archived_workspace'),
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'archived_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

with task_row as (
  insert into public.work_tasks(
    task_code, title, description_document, description_text, scope_type,
    privacy, priority, status, review_policy, created_by
  )
  values (
    app_private.next_work_task_code(), 'WS4 direct task regression', '{"version":1,"type":"doc","content":[]}',
    'direct task remains independent from Workspace membership', 'direct',
    'standard', 'normal', 'pending_acknowledgement', 'creator_review',
    (select user_id from ws4_people where name = 'admin')
  )
  returning id, task_code
)
insert into ws4_data(key, value)
select 'direct_task', jsonb_build_object('id', id, 'code', task_code) from task_row;

insert into public.work_task_assignments(task_id, user_id, assigned_by)
select (select (value->>'id')::uuid from ws4_data where key = 'standard_task'),
  (select user_id from ws4_people where name = 'member'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'restricted_task'),
  (select user_id from ws4_people where name = 'admin'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'former_task'),
  (select user_id from ws4_people where name = 'former_assignee'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'department_task'),
  (select user_id from ws4_people where name = 'member'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'project_task'),
  (select user_id from ws4_people where name = 'member'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'archived_task'),
  (select user_id from ws4_people where name = 'member'),
  (select user_id from ws4_people where name = 'admin')
union all
select (select (value->>'id')::uuid from ws4_data where key = 'direct_task'),
  (select user_id from ws4_people where name = 'member'),
  (select user_id from ws4_people where name = 'admin');

with group_row as (
  insert into public.work_task_groups(name, scope_type, department_id, created_by)
  values (
    'WS4 legacy mapped group', 'department',
    (select (value#>>'{}')::uuid from ws4_data where key = 'department'),
    (select user_id from ws4_people where name = 'admin')
  ) returning id
)
insert into ws4_data(key,value)
select 'department_group',jsonb_build_object('id',id) from group_row;
update public.work_tasks
set task_group_id=(select (value->>'id')::uuid from ws4_data where key='department_group')
where id=(select (value->>'id')::uuid from ws4_data where key='department_task');

with calendar_row as (
  insert into public.work_sla_calendars(
    name,workday_start,workday_end,workspace_id,created_by
  ) values(
    'WS4 private workspace calendar','08:00','17:00',
    (select (value->>'id')::uuid from ws4_data where key='workspace'),
    (select user_id from ws4_people where name='admin')
  ) returning id
)
insert into ws4_data(key,value)
select 'private_calendar',jsonb_build_object('id',id) from calendar_row;
with policy_row as (
  insert into public.work_sla_policies(
    name,scope_type,calendar_id,acknowledgement_minutes,is_active,workspace_id,created_by
  ) values(
    'WS4 private workspace policy','global',
    (select (value->>'id')::uuid from ws4_data where key='private_calendar'),
    30,false,(select (value->>'id')::uuid from ws4_data where key='workspace'),
    (select user_id from ws4_people where name='admin')
  ) returning id
)
insert into ws4_data(key,value)
select 'private_policy',jsonb_build_object('id',id) from policy_row;

-- Former assignee access is proven before revocation and then exercised through
-- every existing detail/subresource reader after revocation.
with comment_row as (
  insert into public.work_task_comments(
    task_id, author_user_id, content_document, content_text
  )
  values (
    (select (value->>'id')::uuid from ws4_data where key = 'former_task'),
    (select user_id from ws4_people where name = 'admin'),
    '{"version":1,"type":"doc","content":[]}', 'WS4 former task comment'
  )
  returning id
)
insert into ws4_data(key, value)
select 'former_comment', jsonb_build_object('id', id) from comment_row;

with attachment_row as (
  insert into public.work_task_attachments(
    task_id, uploader_user_id, file_name, mime_type, size_bytes,
    storage_path, attachment_kind, status, variants, finalized_at
  )
  values (
    (select (value->>'id')::uuid from ws4_data where key = 'former_task'),
    (select user_id from ws4_people where name = 'admin'),
    'ws4-former.txt', 'text/plain', 12,
    (select (value->>'id')::uuid from ws4_data where key = 'former_task')::text || '/old/upload',
    'discussion', 'ready',
    '{"original":{"path":"old/former-task/original","mimeType":"text/plain","sizeBytes":12}}', now()
  )
  returning id, storage_path
)
insert into ws4_data(key, value)
select 'former_attachment', jsonb_build_object('id', id, 'path', storage_path) from attachment_row;
with attachment_row as (
  insert into public.work_task_attachments(
    task_id,uploader_user_id,file_name,mime_type,size_bytes,storage_path,attachment_kind,status,
    processing_token,processing_expires_at
  ) values(
    (select (value->>'id')::uuid from ws4_data where key='former_task'),
    (select user_id from ws4_people where name='former_assignee'),'ws4-processing.txt','text/plain',12,
    (select value->>'id' from ws4_data where key='former_task')||'/processing/upload','discussion','processing',
    gen_random_uuid(),now()+interval '5 minutes'
  ) returning id,processing_token
)
insert into ws4_data(key,value) select 'former_processing_attachment',jsonb_build_object('id',id,'token',processing_token) from attachment_row;

insert into public.work_task_checklist_items(task_id, title, created_by)
values (
  (select (value->>'id')::uuid from ws4_data where key = 'former_task'),
  'WS4 former task checklist',
  (select user_id from ws4_people where name = 'admin')
);
insert into public.work_task_submissions(task_id, iteration, submitted_by, result_document)
values (
  (select (value->>'id')::uuid from ws4_data where key = 'former_task'),
  1,
  (select user_id from ws4_people where name = 'admin'),
  '{"version":1,"type":"doc","content":[]}'
);
insert into public.work_task_events(task_id, event_type, actor_user_id, payload)
select (value->>'id')::uuid, 'task.created',
  (select user_id from ws4_people where name = 'admin'), '{}'
from ws4_data
where key in ('standard_task', 'restricted_task', 'former_task', 'department_task', 'project_task', 'archived_task', 'direct_task');
insert into public.work_task_versions(task_id, version, snapshot, actor_user_id)
select (value->>'id')::uuid, 1, '{}',
  (select user_id from ws4_people where name = 'admin')
from ws4_data
where key in ('standard_task', 'restricted_task', 'former_task', 'department_task', 'project_task', 'archived_task', 'direct_task');

-- Archive is represented by the server state used by the read-only guard.  The
-- task remains readable to an active member, while acknowledgement must fail.
update public.work_tasks
set status = 'completed', completed_at = now(), updated_at = now()
where id = (select (value->>'id')::uuid from ws4_data where key = 'archived_task');

update public.work_workspaces
set status = 'archived', updated_at = now()
where id = (select (value->>'id')::uuid from ws4_data where key = 'archived_workspace');

create function pg_temp.ws4_as(p_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_auth_id uuid;
  v_email text;
  v_sub uuid;
begin
  select auth_id, email into v_auth_id, v_email
  from pg_temp.ws4_people
  where name = p_name;
  if v_email is null then
    raise exception 'WS4_UNKNOWN_PERSONA';
  end if;
  v_sub := coalesce(v_auth_id, gen_random_uuid());
  perform set_config('request.jwt.claim.sub', v_sub::text, true);
  perform set_config('request.jwt.claim.email', v_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_sub, 'email', v_email, 'role', 'authenticated'
  )::text, true);
end;
$$;
grant execute on function pg_temp.ws4_as(text) to authenticated;

set local role authenticated;
select pg_temp.ws4_as('member');
do $$
declare
  v_workspace uuid := (select (value->>'id')::uuid from ws4_data where key = 'workspace');
  v_standard uuid := (select (value->>'id')::uuid from ws4_data where key = 'standard_task');
  v_restricted uuid := (select (value->>'id')::uuid from ws4_data where key = 'restricted_task');
  v_page jsonb;
  v_detail jsonb;
  v_summary jsonb;
begin
  if public.current_app_user_id() is distinct from (select user_id from ws4_people where name = 'member') then
    raise exception 'WS4_AUTH_ID_OR_EMAIL_RESOLUTION_FAILED';
  end if;
  if not exists(select 1 from public.work_sla_calendars
      where id=(select (value->>'id')::uuid from ws4_data where key='private_calendar')) then
    raise exception 'WS4_MEMBER_PRIVATE_CALENDAR_MISSING';
  end if;
  if not exists(select 1 from public.work_sla_policies
      where id=(select (value->>'id')::uuid from ws4_data where key='private_policy')) then
    raise exception 'WS4_MEMBER_PRIVATE_POLICY_MISSING';
  end if;
  v_page := public.list_work_workspace_tasks(v_workspace, '{}', null, 50);
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_standard::text) then
    raise exception 'WS4_STANDARD_MEMBER_LIST_MISSING %', v_page;
  end if;
  if exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_restricted::text) then
    raise exception 'WS4_RESTRICTED_MEMBER_LIST_LEAK %', v_page;
  end if;
  v_summary := public.get_work_workspace(v_workspace);
  if coalesce((v_summary->>'visibleOpenTaskCount')::integer, -1) <> 2 then
    raise exception 'WS4_VISIBLE_TASK_COUNT_LEAK %', v_summary;
  end if;
  v_detail := public.get_work_task_detail((select value->>'code' from ws4_data where key = 'standard_task'));
  if v_detail->'task'->>'id' is distinct from v_standard::text then
    raise exception 'WS4_STANDARD_MEMBER_DETAIL_MISSING %', v_detail;
  end if;
  v_page:=public.list_work_workspace_tasks(v_workspace,jsonb_build_object('search','restricted unrelated'),null,50);
  if jsonb_array_length(v_page->'items')<>0 then raise exception 'WS4_RESTRICTED_SEARCH_LEAK %',v_page;end if;
  begin
    perform public.command_work_task(v_standard,'transfer',jsonb_build_object(
      'userId',(select user_id from ws4_people where name='outsider'),'reason','WS4 must reject outsider transfer'
    ),1,gen_random_uuid());
    raise exception 'WS4_OUTSIDER_TRANSFER_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.ws4_as('restricted_member');
do $$
declare
  v_workspace uuid := (select (value->>'id')::uuid from ws4_data where key = 'workspace');
  v_standard uuid := (select (value->>'id')::uuid from ws4_data where key = 'standard_task');
  v_restricted uuid := (select (value->>'id')::uuid from ws4_data where key = 'restricted_task');
  v_page jsonb;
  v_summary jsonb;
begin
  v_page := public.list_work_workspace_tasks(v_workspace, '{}', null, 50);
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_standard::text) then
    raise exception 'WS4_RESTRICTED_MEMBER_STANDARD_LIST_MISSING %', v_page;
  end if;
  if exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_restricted::text) then
    raise exception 'WS4_RESTRICTED_UNRELATED_LIST_LEAK %', v_page;
  end if;
  v_summary := public.get_work_workspace(v_workspace);
  if coalesce((v_summary->>'visibleOpenTaskCount')::integer, -1) <> 2 then
    raise exception 'WS4_RESTRICTED_VISIBLE_TASK_COUNT_LEAK %', v_summary;
  end if;
  begin
    perform public.get_work_task_detail((select value->>'code' from ws4_data where key = 'restricted_task'));
    raise exception 'WS4_RESTRICTED_UNRELATED_DETAIL_LEAK';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.ws4_as('restricted_viewer');
do $$
declare v_workspace uuid:=(select (value->>'id')::uuid from ws4_data where key='workspace');v_restricted uuid:=(select (value->>'id')::uuid from ws4_data where key='restricted_task');v_page jsonb;
begin
  v_page:=public.list_work_workspace_tasks(v_workspace,'{}',null,50);
  if not exists(select 1 from jsonb_array_elements(v_page->'items')x where x->>'id'=v_restricted::text) then
    raise exception 'WS4_EXPLICIT_RESTRICTED_CAPABILITY_IGNORED %',v_page;
  end if;
end $$;
reset role;

-- A global legacy view_scope grant does not substitute for Workspace membership.
set local role authenticated;
select pg_temp.ws4_as('outsider');
do $$
declare
  v_workspace uuid := (select (value->>'id')::uuid from ws4_data where key = 'workspace');
  v_standard uuid := (select (value->>'id')::uuid from ws4_data where key = 'standard_task');
  v_page jsonb;
begin
  if not app_private.has_permission(public.current_app_user_id(), 'work.task.view_scope', 'global', '*') then
    raise exception 'WS4_OUTSIDER_FIXTURE_GRANT_MISSING';
  end if;
  if exists(select 1 from public.work_tasks where id = v_standard) then
    raise exception 'WS4_OUTSIDER_TABLE_READ_LEAK';
  end if;
  if exists(select 1 from public.work_sla_calendars
      where id=(select (value->>'id')::uuid from ws4_data where key='private_calendar')) then
    raise exception 'WS4_OUTSIDER_PRIVATE_CALENDAR_LEAK';
  end if;
  if exists(select 1 from public.work_sla_policies
      where id=(select (value->>'id')::uuid from ws4_data where key='private_policy')) then
    raise exception 'WS4_OUTSIDER_PRIVATE_POLICY_LEAK';
  end if;
  begin
    perform public.list_work_workspace_tasks(v_workspace, '{}', null, 50);
    raise exception 'WS4_OUTSIDER_WORKSPACE_LIST_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_work_task_detail((select value->>'code' from ws4_data where key = 'standard_task'));
    raise exception 'WS4_OUTSIDER_WORKSPACE_DETAIL_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The former assignee can read while both membership and assignment are active.
set local role authenticated;
select pg_temp.ws4_as('former_assignee');
do $$
declare
  v_detail jsonb;
  v_attachment jsonb;
begin
  v_detail := public.get_work_task_detail((select value->>'code' from ws4_data where key = 'former_task'));
  if v_detail->'task'->>'id' is distinct from (select value->>'id' from ws4_data where key = 'former_task') then
    raise exception 'WS4_FORMER_PRE_REVOKE_DETAIL_MISSING';
  end if;
  v_attachment := public.command_work_attachment(
    'read',
    jsonb_build_object(
      'attachmentId', (select (value->>'id')::uuid from ws4_data where key = 'former_attachment'),
      'variant', 'original'
    ),
    gen_random_uuid()
  );
  if v_attachment->>'path' is distinct from 'old/former-task/original' then
    raise exception 'WS4_FORMER_PRE_REVOKE_ATTACHMENT_READ %', v_attachment;
  end if;
  if v_attachment->>'workspaceId' is distinct from (select value->>'id' from ws4_data where key='workspace')
      or coalesce((v_attachment->>'accessRevision')::bigint,0)<=0 then
    raise exception 'WS4_ATTACHMENT_READ_FENCE_MISSING %',v_attachment;
  end if;
end;
$$;
reset role;

-- Finish the open assignment before the membership command.  This keeps the
-- fixture focused on access revocation rather than the WS2 handoff blocker.
update public.work_task_assignments
set state = 'completed', completed_at = now(), ended_at = now(), updated_at = now()
where task_id = (select (value->>'id')::uuid from ws4_data where key = 'former_task')
  and user_id = (select user_id from ws4_people where name = 'former_assignee');
insert into ws4_data(key, value)
select 'former_revision_before', to_jsonb(revision)
from public.work_workspace_user_revisions
where user_id = (select user_id from ws4_people where name = 'former_assignee');

set local role authenticated;
select pg_temp.ws4_as('admin');
do $$
declare
  v_workspace uuid := (select (value->>'id')::uuid from ws4_data where key = 'workspace');
  v_former uuid := (select user_id from ws4_people where name = 'former_assignee');
  v_preview jsonb;
  v_recipient_preview jsonb;
  v_created jsonb;
  v_clone jsonb;
  v_options jsonb;
  v_result jsonb;
  v_version bigint;
  v_department_version bigint;
begin
  v_version := (public.get_work_workspace(v_workspace)->>'lockVersion')::bigint;
  v_recipient_preview := public.preview_work_task_recipients(
    jsonb_build_array(
      jsonb_build_object('type','user','id',(select user_id from ws4_people where name='member')),
      jsonb_build_object('type','user','id',(select user_id from ws4_people where name='outsider'))
    ),
    jsonb_build_object('type','workspace','workspaceId',v_workspace)
  );
  if not exists(select 1 from jsonb_array_elements(v_recipient_preview->'validRecipients') x
      where x->>'userId'=(select user_id::text from ws4_people where name='member'))
    or not exists(select 1 from jsonb_array_elements(v_recipient_preview->'invalidRecipients') x
      where x->>'userId'=(select user_id::text from ws4_people where name='outsider') and x->>'reason'='NOT_WORKSPACE_MEMBER') then
    raise exception 'WS4_WORKSPACE_RECIPIENT_BOUNDARY %',v_recipient_preview;
  end if;
  v_options:=public.list_work_creation_options('user',jsonb_build_object('type','workspace','workspaceId',v_workspace),'WS4',null,50);
  if not exists(select 1 from jsonb_array_elements(v_options->'items') x where x->>'id'=(select user_id::text from ws4_people where name='member'))
    or exists(select 1 from jsonb_array_elements(v_options->'items') x where x->>'id'=(select user_id::text from ws4_people where name='outsider')) then
    raise exception 'WS4_CREATION_OPTIONS_MEMBER_BOUNDARY %',v_options;
  end if;
  v_options:=public.list_work_creation_options('reviewer',jsonb_build_object('type','workspace','workspaceId',v_workspace),'WS4',null,50);
  if not exists(select 1 from jsonb_array_elements(v_options->'items')x where x->>'id'=(select user_id::text from ws4_people where name='member'))
    or exists(select 1 from jsonb_array_elements(v_options->'items')x where x->>'id'=(select user_id::text from ws4_people where name='outsider')) then
    raise exception 'WS4_REVIEWER_OPTIONS_MEMBER_BOUNDARY %',v_options;
  end if;
  v_recipient_preview:=public.preview_work_task_recipients(
    jsonb_build_array(jsonb_build_object('type','user','id',(select user_id from ws4_people where name='member'))),
    jsonb_build_object('type','workspace','workspaceId',(select value->>'id' from ws4_data where key='department_workspace'))
  );
  v_created:=public.create_work_task(jsonb_build_object(
    'title','WS4 created through workspace scope','description','{"version":1,"type":"doc","content":[]}'::jsonb,
    'scope',jsonb_build_object('type','workspace','workspaceId',(select value->>'id' from ws4_data where key='department_workspace')),
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select user_id from ws4_people where name='member'))),
    'watcherUserIds','[]'::jsonb,'priority','normal','privacy','standard','labels','[]'::jsonb,'checklist','[]'::jsonb
  ),gen_random_uuid(),v_recipient_preview->>'fingerprint');
  if not exists(select 1 from public.work_tasks t where t.id=(v_created->>'taskId')::uuid
      and t.workspace_id=(select (value->>'id')::uuid from ws4_data where key='department_workspace')
      and t.scope_type='department' and t.department_id=(select (value#>>'{}')::uuid from ws4_data where key='department')) then
    raise exception 'WS4_CREATE_SCOPE_NOT_ATTACHED %',v_created;
  end if;
  begin
    perform public.create_work_task(jsonb_build_object(
      'title','WS4 reject outsider watcher','description','{"version":1,"type":"doc","content":[]}'::jsonb,
      'scope',jsonb_build_object('type','workspace','workspaceId',(select value->>'id' from ws4_data where key='department_workspace')),
      'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select user_id from ws4_people where name='member'))),
      'watcherUserIds',jsonb_build_array((select user_id from ws4_people where name='outsider')),
      'priority','normal','privacy','standard','labels','[]'::jsonb,'checklist','[]'::jsonb
    ),gen_random_uuid(),v_recipient_preview->>'fingerprint');
    raise exception 'WS4_OUTSIDER_WATCHER_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  v_clone:=public.get_work_clone_form((v_created->>'taskId')::uuid);
  if v_clone->'draft'->'scope' is distinct from jsonb_build_object(
      'type','workspace','workspaceId',(select value->>'id' from ws4_data where key='department_workspace')) then
    raise exception 'WS4_CLONE_LOST_WORKSPACE_SCOPE %',v_clone;
  end if;
  v_clone:=public.get_work_clone_form((select (value->>'id')::uuid from ws4_data where key='department_task'));
  if v_clone->'draft'->>'taskGroupId' is distinct from (select value->>'id' from ws4_data where key='department_group') then
    raise exception 'WS4_LEGACY_CLONE_GROUP_MISSING %',v_clone;
  end if;
  v_recipient_preview:=public.preview_work_task_recipients(v_clone->'draft'->'recipientSources',v_clone->'draft'->'scope');
  v_created:=public.create_work_task(v_clone->'draft',gen_random_uuid(),v_recipient_preview->>'fingerprint');
  if not exists(select 1 from public.work_tasks t where t.id=(v_created->>'taskId')::uuid
      and t.workspace_id=(select (value->>'id')::uuid from ws4_data where key='department_workspace')
      and t.task_group_id=(select (value->>'id')::uuid from ws4_data where key='department_group')) then
    raise exception 'WS4_LEGACY_CLONE_GROUP_SCOPE_FAILED %',v_created;
  end if;
  v_preview:=public.preview_work_workspace_members(
    (select (value->>'id')::uuid from ws4_data where key='department_workspace'),
    jsonb_build_array(jsonb_build_object('operation','remove','userId',(select user_id from ws4_people where name='member')))
  );
  if not exists(select 1 from jsonb_array_elements(v_preview->'blockers')x
      where x->>'code'='WORK_MEMBER_OPEN_ASSIGNMENTS') then
    raise exception 'WS4_LEGACY_ASSIGNMENT_BLOCKER_MISSING %',v_preview;
  end if;
  v_department_version:=(public.get_work_workspace(
    (select (value->>'id')::uuid from ws4_data where key='department_workspace'))->>'lockVersion')::bigint;
  begin
    perform public.command_work_workspace(
      (select (value->>'id')::uuid from ws4_data where key='department_workspace'),
      'archive','{}',v_department_version,'WS4 must reject legacy open tasks',gen_random_uuid()
    );
    raise exception 'WS4_LEGACY_OPEN_TASK_ARCHIVE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.preview_work_task_recipients('[]'::jsonb,jsonb_build_object(
      'type','workspace','workspaceId',v_workspace,'departmentId',(select value#>>'{}' from ws4_data where key='department')));
    raise exception 'WS4_MIXED_SCOPE_ALLOWED';
  exception when invalid_parameter_value then null;
  end;
  v_preview := public.preview_work_workspace_members(
    v_workspace,
    jsonb_build_array(jsonb_build_object('operation', 'remove', 'userId', v_former))
  );
  if jsonb_array_length(v_preview->'blockers') <> 0 then
    raise exception 'WS4_FORMER_REMOVE_BLOCKED %', v_preview;
  end if;
  v_result := public.apply_work_workspace_members(
    v_workspace, v_preview, v_version, 'WS4 revoke former assignee', gen_random_uuid()
  );
  if (v_result->>'lockVersion')::bigint <= v_version then
    raise exception 'WS4_FORMER_REMOVE_VERSION_NOT_ADVANCED %', v_result;
  end if;
end;
$$;
reset role;

do $$
declare
  v_user uuid := (select user_id from ws4_people where name = 'former_assignee');
  v_before bigint := coalesce((select (value#>>'{}')::bigint from ws4_data where key = 'former_revision_before'), 0);
begin
  if not exists(select 1 from public.work_workspace_user_revisions where user_id = v_user and revision > v_before) then
    raise exception 'WS4_MEMBERSHIP_REVOKE_INVALIDATION_MISSING before=%', v_before;
  end if;
  if app_private.work_notification_mandatory(
      (select id from public.work_task_events where task_id=(select (value->>'id')::uuid from ws4_data where key='former_task') order by created_at limit 1),v_user
    ) is not null then raise exception 'WS4_REMOVED_MEMBER_NOTIFICATION_ELIGIBLE';end if;
end;
$$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare v_ok boolean;begin
  v_ok:=public.finish_work_attachment(
    (select (value->>'id')::uuid from ws4_data where key='former_processing_attachment'),
    (select (value->>'token')::uuid from ws4_data where key='former_processing_attachment'),'{}',null
  );
  if v_ok or not exists(select 1 from public.work_task_attachments where id=(select (value->>'id')::uuid from ws4_data where key='former_processing_attachment')
      and status='rejected' and rejection_code='access_revoked') then
    raise exception 'WS4_REMOVED_MEMBER_ATTACHMENT_FINALIZED';
  end if;
end $$;
reset role;

set local role authenticated;
select pg_temp.ws4_as('former_assignee');
do $$
declare
  v_task uuid := (select (value->>'id')::uuid from ws4_data where key = 'former_task');
  v_code text := (select value->>'code' from ws4_data where key = 'former_task');
  v_attachment uuid := (select (value->>'id')::uuid from ws4_data where key = 'former_attachment');
  v_comment uuid := (select (value->>'id')::uuid from ws4_data where key = 'former_comment');
  v_visible boolean;
  v_page jsonb;
begin
  if not exists(select 1 from public.work_workspace_user_revisions where user_id=(select user_id from ws4_people where name='former_assignee')) then
    raise exception 'WS4_FORMER_REVISION_RLS_MISSING';
  end if;
  if exists(select 1 from public.work_workspace_user_revisions where user_id<>(select user_id from ws4_people where name='former_assignee')) then
    raise exception 'WS4_FORMER_REVISION_RLS_LEAK';
  end if;
  if exists(select 1 from public.work_tasks where id = v_task) then
    raise exception 'WS4_FORMER_TASK_TABLE_READ_LEAK';
  end if;
  begin perform public.get_work_task_detail(v_code); raise exception 'WS4_FORMER_DETAIL_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform public.list_work_task_comments(v_task, null, 50); raise exception 'WS4_FORMER_COMMENTS_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform public.list_work_task_history(v_task, '{}', null, 50); raise exception 'WS4_FORMER_HISTORY_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform public.get_work_clone_form(v_task); raise exception 'WS4_FORMER_CLONE_ALLOWED'; exception when insufficient_privilege then null; end;
  begin
    perform public.command_work_attachment(
      'read', jsonb_build_object('attachmentId', v_attachment, 'variant', 'original'), gen_random_uuid()
    );
    raise exception 'WS4_FORMER_OLD_ATTACHMENT_URL_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.command_work_attachment(
      'begin', jsonb_build_object(
        'taskId', v_task, 'fileName', 'revoked.txt', 'mimeType', 'text/plain',
        'sizeBytes', 7, 'kind', 'discussion', 'keepOriginal', false
      ), gen_random_uuid()
    );
    raise exception 'WS4_FORMER_ATTACHMENT_BEGIN_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.command_work_attachment(
      'delete', jsonb_build_object('attachmentId', v_attachment), gen_random_uuid()
    );
    raise exception 'WS4_FORMER_ATTACHMENT_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    v_page := public.list_work_tasks('assigned_to_me', '{}', null, 50);
    if exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_task::text) then
      raise exception 'WS4_FORMER_LEGACY_LIST_ALLOWED';
    end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_work_workspace_tasks(
      (select (value->>'id')::uuid from ws4_data where key = 'workspace'), '{}', null, 50
    );
    raise exception 'WS4_FORMER_WORKSPACE_LIST_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  select exists(select 1 from public.work_task_comments where task_id = v_task) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_COMMENT_RLS_LEAK'; end if;
  select exists(select 1 from public.work_task_checklist_items where task_id = v_task) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_CHECKLIST_RLS_LEAK'; end if;
  select exists(select 1 from public.work_task_submissions where task_id = v_task) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_SUBMISSION_RLS_LEAK'; end if;
  select exists(select 1 from public.work_task_attachments where id = v_attachment) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_ATTACHMENT_RLS_LEAK'; end if;
  select exists(select 1 from public.work_task_events where task_id = v_task) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_EVENT_RLS_LEAK'; end if;
  select exists(select 1 from public.work_task_versions where task_id = v_task) into v_visible;
  if v_visible then raise exception 'WS4_FORMER_VERSION_RLS_LEAK'; end if;
  begin
    perform public.get_work_task_comment_anchor(v_task, v_comment);
    raise exception 'WS4_FORMER_COMMENT_ANCHOR_ALLOWED';
  exception when insufficient_privilege or undefined_function then null;
  end;
  begin perform public.command_work_task(v_task,'acknowledge','{}',1,gen_random_uuid());raise exception 'WS4_FORMER_LIFECYCLE_ALLOWED';exception when insufficient_privilege then null;end;
  begin perform public.command_work_task_collaboration(v_task,'comment_create',jsonb_build_object('content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"blocked"}]}]}'::jsonb),gen_random_uuid());raise exception 'WS4_FORMER_COMMENT_COMMAND_ALLOWED';exception when insufficient_privilege then null;end;
  begin perform public.list_work_task_mention_candidates(v_task,'',null,20);raise exception 'WS4_FORMER_MENTION_LIST_ALLOWED';exception when insufficient_privilege then null;end;
end;
$$;
reset role;

-- Department/project legacy readers must resolve through the mapped Workspace.
set local role authenticated;
select pg_temp.ws4_as('member');
do $$
declare
  v_page jsonb;
begin
  v_page := public.list_work_workspace_tasks(
    (select (value->>'id')::uuid from ws4_data where key = 'department_workspace'), '{}', null, 50
  );
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item
    where item->>'id' = (select value->>'id' from ws4_data where key = 'department_task')) then
    raise exception 'WS4_LEGACY_DEPARTMENT_MEMBER_LIST_MISSING %', v_page;
  end if;
  v_page := public.list_work_workspace_tasks(
    (select (value->>'id')::uuid from ws4_data where key = 'project_workspace'), '{}', null, 50
  );
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item
    where item->>'id' = (select value->>'id' from ws4_data where key = 'project_task')) then
    raise exception 'WS4_LEGACY_PROJECT_MEMBER_LIST_MISSING %', v_page;
  end if;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.ws4_as('outsider');
do $$
declare
  v_code text;
  v_task uuid;
begin
  for v_code in
    select value->>'code' from ws4_data where key in ('department_task', 'project_task')
  loop
    select (value->>'id')::uuid into v_task
    from ws4_data
    where value->>'code' = v_code;
    if exists(select 1 from public.work_tasks where id = v_task) then
      raise exception 'WS4_LEGACY_OUTSIDER_TABLE_READ_ALLOWED code=%', v_code;
    end if;
    begin
      perform public.get_work_task_detail(v_code);
      raise exception 'WS4_LEGACY_OUTSIDER_DETAIL_ALLOWED code=%', v_code;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;

-- Direct Work stays independent: the assigned member can use the old list and
-- detail reader, while Workspace membership does not grant direct creation.
set local role authenticated;
select pg_temp.ws4_as('member');
do $$
declare
  v_task uuid := (select (value->>'id')::uuid from ws4_data where key = 'direct_task');
  v_page jsonb;
  v_detail jsonb;
begin
  if app_private.has_permission(public.current_app_user_id(), 'work.task.create', 'own', '*') then
    raise exception 'WS4_WORKSPACE_MEMBER_DIRECT_CREATE_OVERGRANT';
  end if;
  if exists(select 1 from public.work_tasks where id = v_task and workspace_id is not null) then
    raise exception 'WS4_DIRECT_TASK_HAS_WORKSPACE';
  end if;
  v_page := public.list_work_tasks('assigned_to_me', '{}', null, 50);
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_task::text) then
    raise exception 'WS4_DIRECT_MEMBER_LIST_MISSING %', v_page;
  end if;
  v_detail := public.get_work_task_detail((select value->>'code' from ws4_data where key = 'direct_task'));
  if v_detail->'task'->>'id' is distinct from v_task::text then
    raise exception 'WS4_DIRECT_MEMBER_DETAIL_MISSING %', v_detail;
  end if;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.ws4_as('outsider');
do $$
begin
  -- The broad legacy scope grant remains meaningful for direct Work tasks.
  if public.get_work_task_detail((select value->>'code' from ws4_data where key = 'direct_task'))->'task'->>'id'
      is distinct from (select value->>'id' from ws4_data where key = 'direct_task') then
    raise exception 'WS4_DIRECT_LEGACY_BEHAVIOR_CHANGED';
  end if;
end;
$$;
reset role;

-- Archived Workspace tasks remain readable to an active member but every
-- command, including personal task preferences, is fenced server-side.
set local role authenticated;
select pg_temp.ws4_as('member');
do $$
declare
  v_task uuid := (select (value->>'id')::uuid from ws4_data where key = 'archived_task');
  v_page jsonb;
  v_version bigint;
begin
  v_page := public.list_work_workspace_tasks(
    (select (value->>'id')::uuid from ws4_data where key = 'archived_workspace'), '{}', null, 50
  );
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item where item->>'id' = v_task::text) then
    raise exception 'WS4_ARCHIVED_MEMBER_LIST_MISSING %', v_page;
  end if;
  if public.get_work_task_detail((select value->>'code' from ws4_data where key = 'archived_task'))->'task'->>'id'
      is distinct from v_task::text then
    raise exception 'WS4_ARCHIVED_MEMBER_DETAIL_MISSING';
  end if;
  v_version := (select lock_version from public.work_tasks where id = v_task);
  begin
    perform public.command_work_task(v_task, 'acknowledge', '{}', v_version, gen_random_uuid());
    raise exception 'WS4_ARCHIVED_MUTATION_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.command_work_task_collaboration(
      v_task,'set_pin',jsonb_build_object('pinned',true),gen_random_uuid()
    );
    raise exception 'WS4_ARCHIVED_PREFERENCE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if to_regclass('app_private.work_notification_settings') is not null
     and exists(select 1 from app_private.work_notification_settings where enabled) then
    raise exception 'WS4_NOTIFICATION_DELIVERY_ENABLED_IN_SMOKE';
  end if;
  if exists(
    select 1
    from app_private.work_notification_outbox
    where task_id in (
      select (value->>'id')::uuid from ws4_data
      where key like '%_task'
    )
  ) then
    raise exception 'WS4_SMOKE_EMITTED_NOTIFICATION_OUTBOX_ROWS';
  end if;
end;
$$;

select 'WORK_WORKSPACE_TASK_ACCESS_SMOKE_PASSED' as result;
rollback;
