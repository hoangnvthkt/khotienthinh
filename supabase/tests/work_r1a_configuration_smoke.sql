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

reset role;
create temporary table work_config_assignment_snapshot as select to_jsonb(a) value from public.work_task_assignments a where task_id in(select (value->>'taskId')::uuid from work_collab_data where key in ('task','restricted'));
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason) select id,'work.task.configure','global','*','rollback smoke' from work_collab_people where name='creator';
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare r jsonb; v_cal uuid; k uuid:=gen_random_uuid(); v_data jsonb; v_policy jsonb; preview jsonb; before_count integer; begin
 v_data:='{"name":"Configured calendar","timezone":"Asia/Ho_Chi_Minh","working_weekdays":[1,2,3,4,5],"working_intervals":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}],"is_default":false}';
 r:=public.save_work_configuration('calendar','{"type":"global"}',null,null,v_data,'Create rollback calendar',k);v_cal:=(r->>'id')::uuid;
 if public.save_work_configuration('calendar','{"type":"global"}',null,null,v_data,'Create rollback calendar',k)<>r then raise exception 'TEST_CONFIG_RETRY'; end if;
 insert into work_collab_data values('config_cal',r);
 begin perform public.save_work_configuration('calendar','{"type":"global"}',v_cal,999,v_data,'Stale write',gen_random_uuid());raise exception 'TEST_STALE_CONFIG';exception when raise_exception then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise;end if;end;
 begin perform public.save_work_configuration('calendar','{"type":"global"}',null,null,v_data||'{"working_intervals":[{"start":"13:00","end":"12:00"}]}','Bad intervals',gen_random_uuid());raise exception 'TEST_BAD_INTERVAL';exception when invalid_parameter_value then null;end;
 v_policy:=jsonb_build_object('name','Configured policy','calendar_id',v_cal,'priority','urgent','acknowledgement_minutes',60,'execution_minutes',480,'effective_from','2026-01-01T00:00:00Z');
 r:=public.save_work_configuration('policy','{"type":"global"}',null,null,v_policy,'Set explicit SLA',gen_random_uuid());
 begin perform public.save_work_configuration('policy','{"type":"global"}',null,null,v_policy||'{"effective_to":"2027-01-01T00:00:00Z"}','Overlapping policy',gen_random_uuid());raise exception 'TEST_OVERLAP';exception when raise_exception then if sqlerrm<>'WORK_POLICY_OVERLAP' then raise;end if;end;
 preview:=public.preview_work_configuration_sla('{"type":"global"}','urgent','2026-09-07T04:30:00Z');
 if (preview->>'acknowledgementDueAt')::timestamptz<>'2026-09-07T06:30:00Z'::timestamptz then raise exception 'TEST_BREAK_SLA'; end if;
 r:=public.save_work_configuration('exception','{"type":"global"}',null,null,jsonb_build_object('calendar_id',v_cal,'exception_date','2026-09-08','is_working_day',false),'Holiday override',gen_random_uuid());
 if public.list_work_configuration('exception','{"type":"global"}',v_cal)->'items'->0->>'id'<>r->>'id' then raise exception 'TEST_EXCEPTION_READ';end if;
 perform public.save_work_configuration('exception','{"type":"global"}',(r->>'id')::uuid,1,'{"remove":true}','Restore normal calendar day',gen_random_uuid());
 if public.list_work_configuration('exception','{"type":"global"}',v_cal)->'items'<>'[]' then raise exception 'TEST_EXCEPTION_REMOVE';end if;
 begin perform public.save_work_configuration('calendar','{"type":"global"}',v_cal,1,'{"is_active":false}','Disable calendar in use',gen_random_uuid());raise exception 'TEST_CALENDAR_IN_USE';exception when raise_exception then if sqlerrm<>'WORK_CALENDAR_IN_USE' then raise;end if;end;
 if jsonb_array_length(public.list_work_configuration_scopes()->'items')=0 then raise exception 'TEST_CONFIG_SCOPES';end if;
end $$;

reset role;
insert into work_collab_data values ('department',to_jsonb(gen_random_uuid())),('other_department',to_jsonb(gen_random_uuid()));
insert into public.org_units(id,name) select (value#>>'{}')::uuid,'Work config rollback '||key from work_collab_data where key in ('department','other_department');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.configure','department',(select value#>>'{}' from work_collab_data where key='department'),'rollback scoped config' from work_collab_people where name='manager';
set local role authenticated;
select pg_temp.work_as('manager');
do $$ declare s jsonb:=jsonb_build_object('type','department','departmentId',(select value#>>'{}' from work_collab_data where key='department')); other_s jsonb:=jsonb_build_object('type','department','departmentId',(select value#>>'{}' from work_collab_data where key='other_department')); r jsonb; c uuid:=(select (value->>'id')::uuid from work_collab_data where key='config_cal'); begin
 if jsonb_array_length(public.list_work_configuration_scopes()->'items')<>1 then raise exception 'TEST_SCOPED_CHOICES';end if;
 r:=public.save_work_configuration('group',s,null,null,'{"name":"Scoped bucket"}','Create scoped bucket',gen_random_uuid());
 if public.list_work_configuration('group',s,null,null,1,(r->>'id')::uuid)->'items'->0->>'id'<>r->>'id' then raise exception 'TEST_EXACT_CONFIG_READ';end if;
 if public.list_work_configuration_history(s)->'items'->0->>'reason'<>'Create scoped bucket' then raise exception 'TEST_SCOPED_AUDIT';end if;
 begin perform public.list_work_configuration('group',other_s);raise exception 'TEST_OTHER_SCOPE_READ';exception when insufficient_privilege then null;end;
 begin perform public.list_work_configuration_history(other_s);raise exception 'TEST_OTHER_SCOPE_HISTORY';exception when insufficient_privilege then null;end;
 begin perform public.save_work_configuration('group',other_s,null,null,'{"name":"Wrong scope"}','Unauthorized other scope',gen_random_uuid());raise exception 'TEST_OTHER_SCOPE_WRITE';exception when insufficient_privilege then null;end;
 begin perform public.save_work_configuration('calendar',s,c,1,'{"name":"Overwrite global"}','Unauthorized shared edit',gen_random_uuid());raise exception 'TEST_SHARED_CALENDAR_WRITE';exception when insufficient_privilege then null;end;
 begin perform public.list_work_configuration('exception',s,c);raise exception 'TEST_SHARED_EXCEPTION_READ';exception when insufficient_privilege then null;end;
 if not exists(select 1 from jsonb_array_elements(public.list_work_configuration('calendar_option',s)->'items') x where x->>'id'=c::text) then raise exception 'TEST_SHARED_CALENDAR_OPTION';end if;
 perform public.save_work_configuration('policy',s,null,null,jsonb_build_object('name','Scoped policy','calendar_id',c,'acknowledgement_minutes',60),'Use shared calendar',gen_random_uuid());
end $$;
select pg_temp.work_as('outsider');
do $$ begin
 if public.list_work_configuration_scopes()->'items'<>'[]' then raise exception 'TEST_OUTSIDER_SCOPES';end if;
 begin perform public.list_work_configuration('calendar','{"type":"global"}');raise exception 'TEST_OUTSIDER_CONFIG_READ';exception when insufficient_privilege then null;end;
 begin perform public.save_work_configuration('calendar','{"type":"global"}',null,null,'{}','Unauthorized edit',gen_random_uuid());raise exception 'TEST_OUTSIDER_CONFIG_WRITE';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select count(*) from app_private.work_configuration_events where actor_user_id in(select id from work_collab_people))<>6 then raise exception 'TEST_CONFIGURATION_AUDIT_COUNT';end if;
 if exists(select value from work_config_assignment_snapshot except select to_jsonb(a) from public.work_task_assignments a) then raise exception 'TEST_EXISTING_ASSIGNMENTS_CHANGED';end if;
end $$;
select 'WORK_CONFIGURATION_SMOKE_PASSED' as result;
rollback;
