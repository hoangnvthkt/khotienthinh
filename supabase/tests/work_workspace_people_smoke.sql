begin;
do $$ begin if to_regprocedure('public.list_work_workspace_people(uuid,text,text,jsonb,integer)') is null then raise exception 'WORK_WORKSPACE_PEOPLE_MISSING';end if;end $$;
create temp table ws3_people(name text primary key,user_id uuid,employee_id uuid,slot_id uuid,email text) on commit drop;
create temp table ws3_data(key text primary key,value jsonb) on commit drop;
grant select on ws3_people to authenticated;
grant select,insert,update on ws3_data to authenticated;
insert into ws3_people select n,case when n in('no_account','no_account_2') then null else gen_random_uuid() end,gen_random_uuid(),gen_random_uuid(),'ws3-'||gen_random_uuid()||'@invalid.local'
from unnest(array['admin','dual','current','future','ended','no_account','no_account_2','disabled','manual','transferred','outsider']) n;
insert into public.users(id,name,username,email,role,is_active,account_status,allowed_modules)
select user_id,'WS3 '||name,'ws3-'||user_id,email,'EMPLOYEE',name<>'disabled',case when name='disabled' then 'DISABLED' else 'ACTIVE' end,'{}' from ws3_people where user_id is not null;
insert into public.employees(id,full_name,user_id,email) select employee_id,'WS3 '||name,user_id,email from ws3_people;
insert into public.employees(full_name,user_id) select 'WS3 dual alias',user_id from ws3_people where name='dual';
with d as(insert into public.org_units(name) values('WS3 Department A'),('WS3 Department B') returning id,name)
insert into ws3_data select name,to_jsonb(id) from d;
with p as(insert into public.hrm_positions(name) values('WS3 Position') returning id)
insert into ws3_data select 'position',to_jsonb(id) from p;
insert into public.hrm_org_position_slots(id,code,org_unit_id,position_id,effective_from)
select slot_id,'WS3-'||slot_id,(select (value#>>'{}')::uuid from ws3_data where key=case when name in('manual','outsider') then 'WS3 Department B' else 'WS3 Department A' end),(select (value#>>'{}')::uuid from ws3_data where key='position'),current_date-30 from ws3_people;
insert into public.hrm_employee_slot_assignments(employee_id,slot_id,assignment_type,status,effective_from,effective_to)
select employee_id,slot_id,'PRIMARY','ACTIVE',case when name='future' then current_date+1 else current_date-20 end,case when name in('ended','transferred') then current_date-1 else null end from ws3_people;
with s as(insert into public.hrm_org_position_slots(code,org_unit_id,position_id,effective_from)
select 'WS3-dual-'||gen_random_uuid(),(select (value#>>'{}')::uuid from ws3_data where key='WS3 Department A'),(select (value#>>'{}')::uuid from ws3_data where key='position'),current_date-30 returning id)
insert into public.hrm_employee_slot_assignments(employee_id,slot_id,assignment_type,effective_from)
select (select employee_id from ws3_people where name='dual'),s.id,'SECONDARY',current_date-10 from s;
with w as(insert into public.work_workspaces(kind,department_id,name,created_by,access_mode)
select 'department',(select (value#>>'{}')::uuid from ws3_data where key='WS3 Department A'),'WS3 source workspace',user_id,'workspace' from ws3_people where name='admin' returning id)
insert into ws3_data select 'workspace',to_jsonb(id) from w;
insert into public.work_workspace_members(workspace_id,user_id,role,added_by,origin,source_reference)
select (select (value#>>'{}')::uuid from ws3_data where key='workspace'),user_id,case when name='admin' then 'admin' else 'member' end,(select user_id from ws3_people where name='admin'),case when name in('current','transferred') then 'organization' else 'manual' end,case when name in('current','transferred') then(select value#>>'{}' from ws3_data where key='WS3 Department A') end
from ws3_people where name in('admin','current','manual','transferred');
with p as(insert into public.projects(id,code,name,status) values('ws3-project-'||gen_random_uuid(),'WS3-'||gen_random_uuid(),'WS3 Project','active') returning id)
insert into ws3_data select 'project',to_jsonb(id) from p;
with w as(insert into public.work_workspaces(kind,project_id,name,created_by,access_mode)
select 'project',(select value#>>'{}' from ws3_data where key='project'),'WS3 project workspace',user_id,'workspace' from ws3_people where name='admin' returning id)
insert into ws3_data select 'project_workspace',to_jsonb(id) from w;
insert into public.work_workspace_members(workspace_id,user_id,role,added_by)
select (select (value#>>'{}')::uuid from ws3_data where key='project_workspace'),user_id,'admin',user_id from ws3_people where name='admin';
insert into public.project_staff(project_id,user_id,position_id,start_date,end_date)
select (select value#>>'{}' from ws3_data where key='project'),user_id::text,(select (value#>>'{}')::uuid from ws3_data where key='position'),case when name='future' then current_date+1 else current_date-20 end,case when name='ended' then current_date-1 when name='current' then current_date else null end from ws3_people where name in('dual','current','future','ended');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws3_people where name='admin';
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');p jsonb;d jsonb;begin
 if public.current_app_user_id() is distinct from(select user_id from ws3_people where name='admin') then raise exception 'TEST_WS3_IDENTITY';end if;
 p:=public.list_work_workspace_people(w,'organization','WS3',null,50);
 if(select count(*) from jsonb_array_elements(p->'items') x where x->>'userId'=(select user_id::text from ws3_people where name='dual'))<>1 then raise exception 'TEST_DUAL_ASSIGNMENT_DEDUPE %',p;end if;
 if(select count(*) from jsonb_array_elements(p->'items') x where x->>'userId' is null)<>2 then raise exception 'TEST_DISTINCT_ACCOUNTLESS_PEOPLE %',p;end if;
 if not exists(select 1 from jsonb_array_elements(p->'items') x where x->>'employeeId'=(select employee_id::text from ws3_people where name='no_account') and x->>'userId' is null and x->>'eligibility'='NO_APP_ACCOUNT') then raise exception 'TEST_NO_ACCOUNT';end if;
 if not exists(select 1 from jsonb_array_elements(p->'items') x where x->>'userId'=(select user_id::text from ws3_people where name='disabled') and x->>'eligibility'='ACCOUNT_INACTIVE') then raise exception 'TEST_DISABLED_SUGGESTION';end if;
 if exists(select 1 from jsonb_array_elements(p->'items') x where x->>'userId' in(select user_id::text from ws3_people where name in('future','ended','transferred','manual','outsider'))) then raise exception 'TEST_EFFECTIVE_SOURCE_LEAK';end if;
 if not exists(select 1 from jsonb_array_elements(p->'items') x where x->>'userId'=(select user_id::text from ws3_people where name='current') and (x->>'alreadyMember')::boolean) then raise exception 'TEST_EXISTING_MEMBER';end if;
 if exists(select 1 from jsonb_array_elements(p->'items') x where x ?| array['email','phone','salary','dateOfBirth','address','allowedModules']) then raise exception 'TEST_PRIVATE_PROFILE_LEAK';end if;
 d:=public.list_work_workspace_people(w,'directory','WS3 dual',null,50);
 if jsonb_array_length(d->'items')<>1 then raise exception 'TEST_DIRECTORY_USER_DEDUPE %',d;end if;
 d:=public.preview_work_workspace_source_diff(w,null,50);
 if exists(select 1 from jsonb_array_elements(d->'items') x where x->'change'->>'operation'='remove' and x->'change'->>'userId'=(select user_id::text from ws3_people where name='manual')) then raise exception 'TEST_MANUAL_MEMBER_PRESERVED';end if;
 if not exists(select 1 from jsonb_array_elements(d->'items') x where x->'change'->>'operation'='remove' and x->'change'->>'userId'=(select user_id::text from ws3_people where name='transferred')) then raise exception 'TEST_SOURCE_DEPARTURE_DIFF %',d;end if;
 p:=public.list_work_workspace_people(w,'organization','WS3',null,1);
 d:=public.list_work_workspace_people(w,'organization','WS3',p->'nextCursor',1);
 if p->>'nextCursor' is null or (p->'items'->0->>'userId',p->'items'->0->>'employeeId') is not distinct from(d->'items'->0->>'userId',d->'items'->0->>'employeeId') then raise exception 'TEST_PEOPLE_PAGINATION';end if;
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','add','userId',(select user_id from ws3_people where name='dual'),'role','member','origin','organization','sourceReference',(select value#>>'{}' from ws3_data where key='WS3 Department A'))));
 insert into ws3_data values('preview',p);
end $$;
reset role;
-- A change to a secondary assignment must invalidate the selection even while the
-- person's primary assignment still makes them eligible for the source.
update public.hrm_employee_slot_assignments set status='ENDED',effective_to=current_date-1
where employee_id=(select employee_id from ws3_people where name='dual') and assignment_type='SECONDARY';
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');p jsonb;begin
 begin perform public.apply_work_workspace_members(w,(select value from ws3_data where key='preview'),1,'Reject changed secondary assignment',gen_random_uuid());raise exception 'TEST_SECONDARY_SOURCE_DRIFT_ACCEPTED';exception when sqlstate 'P0001' then if sqlerrm<>'WORK_MEMBERSHIP_PREVIEW_STALE' then raise;end if;end;
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','add','userId',(select user_id from ws3_people where name='dual'),'role','member','origin','organization','sourceReference',(select value#>>'{}' from ws3_data where key='WS3 Department A'))));
 update ws3_data set value=p where key='preview';
end $$;
reset role;
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='project_workspace');p jsonb;begin
 p:=public.list_work_workspace_people(w,'project','WS3',null,50);
 if exists(select 1 from jsonb_array_elements(p->'items') x where x->>'userId' in(select user_id::text from ws3_people where name in('future','ended'))) then raise exception 'TEST_PROJECT_EFFECTIVE_DATES';end if;
 if not exists(select 1 from jsonb_array_elements(p->'items') x where x->>'userId'=(select user_id::text from ws3_people where name='current')) then raise exception 'TEST_PROJECT_END_DATE_INCLUSIVE';end if;
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','add','userId',(select user_id from ws3_people where name='dual'),'role','member','origin','project','sourceReference',(select value#>>'{}' from ws3_data where key='project'))));
 perform public.apply_work_workspace_members(w,p,1,'Selected project membership',gen_random_uuid());
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.work_workspace_members where workspace_id=(select (value#>>'{}')::uuid from ws3_data where key='project_workspace') and user_id=(select user_id from ws3_people where name='dual') and origin='project' and source_reference=(select value#>>'{}' from ws3_data where key='project')) then raise exception 'TEST_PROJECT_PROVENANCE';end if;
end $$;
-- HRM edits never synchronize membership implicitly, but invalidate selected preview.
update public.hrm_employee_slot_assignments set status='ENDED',effective_to=current_date-1 where employee_id=(select employee_id from ws3_people where name='dual');
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');begin
 begin perform public.apply_work_workspace_members(w,(select value from ws3_data where key='preview'),1,'Apply stale organization selection',gen_random_uuid());raise exception 'TEST_SOURCE_DRIFT_ACCEPTED';exception when sqlstate 'P0001' then if sqlerrm<>'WORK_MEMBERSHIP_PREVIEW_STALE' then raise;end if;end;
end $$;
reset role;
do $$ begin if exists(select 1 from public.work_workspace_members where workspace_id=(select (value#>>'{}')::uuid from ws3_data where key='workspace') and user_id=(select user_id from ws3_people where name='dual')) then raise exception 'TEST_AUTOMATIC_SYNC';end if;end $$;
-- Expired source members can be explicitly invited again; authority cannot be made indefinite.
update public.work_workspace_members set starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
where workspace_id=(select (value#>>'{}')::uuid from ws3_data where key='workspace') and user_id=(select user_id from ws3_people where name='current');
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');p jsonb;begin
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','add','userId',(select user_id from ws3_people where name='current'),'role','member','origin','organization','sourceReference',(select value#>>'{}' from ws3_data where key='WS3 Department A'),'expiresAt',now()+interval '1 hour')));
 perform public.apply_work_workspace_members(w,p,(public.get_work_workspace(w)->>'lockVersion')::bigint,'Explicitly renew expired member',gen_random_uuid());
end $$;
reset role;
update public.work_workspace_members set expires_at=now()+interval '2 hours'
where workspace_id=(select (value#>>'{}')::uuid from ws3_data where key='workspace') and user_id=(select user_id from ws3_people where name='admin');
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');begin
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',(select user_id from ws3_people where name='current'),'role','member','expiresAt',null)));raise exception 'TEST_MEMBER_NULL_EXPIRY_ESCALATION';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws3_people where name='current';
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws3_data where key='workspace');begin
 begin perform public.list_work_workspace_people(w,'directory','',null,30);raise exception 'TEST_MEMBER_DIRECTORY';exception when insufficient_privilege then null;end;
 begin perform public.preview_work_workspace_source_diff(w,null,30);raise exception 'TEST_MEMBER_DIFF';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'WORK_WORKSPACE_PEOPLE_SMOKE_PASSED' result;
rollback;
