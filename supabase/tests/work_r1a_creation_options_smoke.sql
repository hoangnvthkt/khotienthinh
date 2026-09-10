begin;
create temporary table work_collab_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_collab_data(key text primary key,value jsonb) on commit drop;
grant select on work_collab_people to authenticated;
grant all on work_collab_data to authenticated;
insert into work_collab_people select name,gen_random_uuid(),'collab-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','assignee','watcher','replacement','outsider','inactive','manager','reviewer']) name;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,name,'collab-'||id,email,'EMPLOYEE',name<>'inactive',case when name='inactive' then 'DISABLED' else 'ACTIVE' end from work_collab_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','rollback smoke' from work_collab_people where name<>'inactive';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'global','*','rollback smoke' from work_collab_people cross join unnest(array['work.task.view_related','work.task.assign_user','work.task.review']) code where name not in ('inactive');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'own','*','rollback smoke' from work_collab_people cross join unnest(array['work.task.create','work.task.audit_view']) code where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.audit_view','assigned','*','rollback smoke' from work_collab_people where name in ('assignee','manager');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,'work.task.manage_scope','global','*','rollback smoke',now()+interval '1 day' from work_collab_people where name='creator';
insert into public.work_sla_calendars(name,workday_start,workday_end,is_default,created_by)
select 'Collaboration rollback calendar','08:00','17:00',true,id from work_collab_people where name='creator';
create function pg_temp.work_as(p_name text) returns void language plpgsql security invoker set search_path='' as $$ begin
  perform set_config('request.jwt.claims',(select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text from pg_temp.work_collab_people where name=p_name),true);
end $$;
create function pg_temp.work_doc(p_text text) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',p_text)))));
$$;
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare v_input jsonb; v_preview jsonb; v_result jsonb; begin
  v_input:=jsonb_build_object('title','Collaboration task','description',pg_temp.work_doc('Discussion fixture'),'scope','{"type":"direct"}'::jsonb,
    'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_collab_people where name='assignee'))),
    'watcherUserIds',jsonb_build_array((select id from work_collab_people where name='watcher')),
    'reviewPolicy','reviewer_review','reviewerUserId',(select id from work_collab_people where name='reviewer'),
    'priority','normal','privacy','standard','labels','[]'::jsonb,'checklist','[]'::jsonb);
  v_preview:=public.preview_work_task_recipients(v_input->'recipientSources',v_input->'scope');
  v_result:=public.create_work_task(v_input,gen_random_uuid(),v_preview->>'fingerprint');
  insert into work_collab_data values('input',v_input),('task',v_result);
  v_result:=public.create_work_task(v_input||'{"privacy":"restricted"}',gen_random_uuid(),v_preview->>'fingerprint');
  insert into work_collab_data values('restricted',v_result);
end $$;

do $$ declare v_r jsonb; v_first jsonb; begin
 v_first:=public.list_work_tasks('created_by_me');
 if v_first->'items'->0->>'assignment_count'<>'1' or v_first->'items'->0->>'acknowledged_count'<>'0' then raise exception 'TEST_SUMMARY_ACK_COUNTS'; end if;
 v_r:=public.get_work_creation_context('{"type":"direct"}');
 if v_r->>'canCreate'<>'true' or v_r->>'canAssignUser'<>'true' or v_r->>'calendarReady'<>'true' then raise exception 'TEST_CREATION_CONTEXT'; end if;
 v_r:=public.get_work_clone_form((select (value->>'taskId')::uuid from work_collab_data where key='task'));
 if v_r->'labels'->>(select id::text from work_collab_people where name='assignee')<>'assignee' or v_r->'draft' ? 'taskCode' then raise exception 'TEST_CLONE_FORM_LABELS_OR_WRITES'; end if;
 v_r:=public.list_work_creation_options('scope');
 if not exists(select 1 from jsonb_array_elements(v_r->'items') where value->>'id'='direct') then raise exception 'TEST_SCOPE_OPTIONS'; end if;
 begin perform public.list_work_creation_options('user','{"type":"direct"}','','{}',1); raise exception 'TEST_BAD_CURSOR'; exception when invalid_parameter_value then null; end;
 begin perform public.list_work_creation_options('user','{"type":"direct"}','','{"id":{}}',1); raise exception 'TEST_NON_STRING_CURSOR'; exception when invalid_parameter_value then null; end;
 v_first:=public.list_work_creation_options('user','{"type":"direct"}','',null,1);
 if jsonb_array_length(v_first->'items')<>1 or v_first->'nextCursor'='null' then raise exception 'TEST_BOUNDED_OPTIONS'; end if;
 v_r:=public.list_work_creation_options('user','{"type":"direct"}','',v_first->'nextCursor',1);
 if v_r->'items'->0->>'id'=v_first->'items'->0->>'id' then raise exception 'TEST_CURSOR_REPEAT'; end if;
 if exists(select 1 from jsonb_array_elements(v_r->'items') where value-array['id','name','kind']<>'{}') then raise exception 'TEST_OPTION_PRIVATE_DATA'; end if;
 begin perform public.list_work_creation_options('work_group','{"type":"direct"}'); raise exception 'TEST_GROUP_WITHOUT_GRANT'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('outsider');
do $$ begin
 if public.list_work_creation_options('scope')->'items'<>'[]' then raise exception 'TEST_OUTSIDER_CREATE_SCOPES'; end if;
 begin perform public.get_work_clone_form((select (value->>'taskId')::uuid from work_collab_data where key='task')); raise exception 'TEST_OUTSIDER_CLONE'; exception when insufficient_privilege then null; end;
 if public.list_work_creation_options('filter_scope')->'items'<>'[{"id":"direct","name":"Trực tiếp","kind":"direct"}]'::jsonb then raise exception 'TEST_FILTER_SCOPE_LEAK'; end if;
 begin perform public.get_work_creation_context('{"type":"direct"}'); raise exception 'TEST_OUTSIDER_CONTEXT'; exception when insufficient_privilege then null; end;
 begin perform public.list_work_creation_options('user','{"type":"direct"}'); raise exception 'TEST_OUTSIDER_DIRECTORY'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('inactive');
do $$ begin begin perform public.list_work_creation_options('scope'); raise exception 'TEST_INACTIVE_OPTIONS'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- Fixture calendar name comes from the shared setup; disable only rollback-owned rows.
update public.work_sla_calendars set is_active=false where created_by=(select id from work_collab_people where name='creator');
set local role authenticated;
select pg_temp.work_as('creator');
do $$ begin
 if public.get_work_creation_context('{"type":"direct"}','urgent')->>'calendarReady'<>'false' then raise exception 'TEST_MISSING_CALENDAR_CONTEXT'; end if;
end $$;
reset role;
select 'WORK_CREATION_OPTIONS_SMOKE_PASSED' as result;
rollback;
