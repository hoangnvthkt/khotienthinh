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

do $$ declare t uuid:=(select (value->>'taskId')::uuid from work_collab_data where key='task'); r jsonb; c jsonb; cid uuid; begin
 r:=public.get_work_task_ui_context(t,array[(select id from work_collab_people where name='assignee'),(select id from work_collab_people where name='outsider')]);
 if r->'names'->>(select id::text from work_collab_people where name='assignee')<>'assignee' or r->'names' ? (select id::text from work_collab_people where name='outsider') then raise exception 'TEST_NAMES_LEAK'; end if;
 r:=public.list_work_task_assignment_candidates(t,'add_assignees','',null,1);
 if jsonb_array_length(r->'items')<>1 or r->'nextCursor'='null' then raise exception 'TEST_CANDIDATE_BOUND'; end if;
 c:=public.list_work_task_assignment_candidates(t,'add_assignees','', (r->>'nextCursor')::uuid,1);
 if c->'items'->0->>'userId'=r->'items'->0->>'userId' then raise exception 'TEST_CURSOR_REPEAT'; end if;
 r:=public.list_work_task_assignment_candidates((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),'add_assignees');
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'userId'=(select id::text from work_collab_people where name='outsider')) then raise exception 'TEST_RESTRICTED_CANDIDATE'; end if;
 c:=public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Anchor parent')),gen_random_uuid()); cid:=(c->'comment'->>'id')::uuid;
 c:=public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.work_doc('Anchor child'),'parentCommentId',cid),gen_random_uuid());
 r:=public.get_work_task_comment_anchor(t,(c->'comment'->>'id')::uuid);
 if r->'parent'->>'id'<>cid::text or r->'comment'->>'can_edit'<>'true' then raise exception 'TEST_ANCHOR'; end if;
 begin perform public.get_work_task_comment_anchor((select (value->>'taskId')::uuid from work_collab_data where key='restricted'),cid); raise exception 'TEST_CROSS_TASK_ANCHOR'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('assignee');
do $$ begin
 -- No create grant is needed to transfer one's own assignment.
 perform public.list_work_task_assignment_candidates((select (value->>'taskId')::uuid from work_collab_data where key='task'),'transfer');
end $$;
select pg_temp.work_as('watcher');
do $$ begin
 begin perform public.list_work_task_assignment_candidates((select (value->>'taskId')::uuid from work_collab_data where key='task'),'add_assignees'); raise exception 'TEST_WATCHER_MUTATION_OPTIONS'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.work_as('outsider');
do $$ begin
 begin perform public.get_work_task_ui_context((select (value->>'taskId')::uuid from work_collab_data where key='task')); raise exception 'TEST_OUTSIDER_CONTEXT'; exception when insufficient_privilege then null; end;
 begin perform public.get_work_task_comment_anchor((select (value->>'taskId')::uuid from work_collab_data where key='task'),gen_random_uuid()); raise exception 'TEST_OUTSIDER_ANCHOR'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'WORK_DETAIL_UI_READS_SMOKE_PASSED' as result;
rollback;
