begin;
-- This assertion must fail before foundation migration exists.
do $$ begin
 if to_regclass('public.work_workspaces') is null then raise exception 'WORK_WORKSPACE_FOUNDATION_MISSING';end if;
end $$;
create temp table ws1_state(key text primary key,value jsonb) on commit drop;
insert into ws1_state values
 ('tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.work_tasks t)),
 ('assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.work_task_assignments a)),
 ('calendars',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.work_sla_calendars c)),
 ('policies',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.work_sla_policies p));
do $$ declare u uuid:=gen_random_uuid(); d1 uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();p1 text:='ws1-'||gen_random_uuid();p2 text:='ws1-'||gen_random_uuid();w1 uuid;w2 uuid;w3 uuid; begin
 insert into public.users(id,name,username,email,role,is_active,account_status) values(u,'Workspace rollback actor','ws1-'||u,'ws1-'||u||'@invalid.local','EMPLOYEE',true,'ACTIVE');
 insert into public.org_units(id,name) values(d1,'WS1 Department A'),(d2,'WS1 Department B');
 insert into public.projects(id,code,name) values(p1,p1,'WS1 Project A'),(p2,p2,'WS1 Project B');
 insert into public.work_workspaces(kind,department_id,name,created_by) values('department',d1,'Workspace A',u) returning id into w1;
 insert into public.work_workspaces(kind,project_id,name,created_by) values('project',p1,'Workspace B',u) returning id into w2;
 insert into public.work_workspaces(kind,name,created_by) values('collaboration','Workspace C',u) returning id into w3;
 insert into public.work_workspace_members(workspace_id,user_id,role,added_by) values(w1,u,'admin',u),(w3,u,'member',u);
 insert into public.work_workspace_preferences(user_id,workspace_id,pinned) values(u,w1,true);
 insert into ws1_state values('workspace',to_jsonb(w1)),('user',to_jsonb(u));
 begin insert into public.work_workspaces(kind,department_id,project_id,name,created_by) values('department',d2,p2,'Wrong shape',u);raise exception 'TEST_SCOPE_SHAPE';exception when check_violation then null;end;
 begin insert into public.work_workspaces(kind,name,created_by) values('project','Missing source',u);raise exception 'TEST_MISSING_SOURCE';exception when check_violation then null;end;
 begin insert into public.work_workspaces(kind,project_id,name,created_by) values('project',p1,'Duplicate project',u);raise exception 'TEST_PROJECT_UNIQUE';exception when unique_violation then null;end;
 update public.work_workspaces set status='archived' where id=w1;
 begin insert into public.work_workspaces(kind,department_id,name,created_by) values('department',d1,'Duplicate archived source',u);raise exception 'TEST_ARCHIVED_SOURCE_UNIQUE';exception when unique_violation then null;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by) values(w1,u,'member',u);raise exception 'TEST_MEMBER_UNIQUE';exception when unique_violation then null;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by) values(w2,u,'owner',u);raise exception 'TEST_ROLE_ALLOWLIST';exception when check_violation then null;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by,expires_at) values(w2,u,'member',u,now()-interval '1 day');raise exception 'TEST_MEMBER_RANGE';exception when check_violation then null;end;
 begin update public.work_workspaces set department_id=d2 where id=w1;raise exception 'TEST_SOURCE_IMMUTABLE';exception when invalid_parameter_value then if sqlerrm <> 'WORK_WORKSPACE_SOURCE_IMMUTABLE' then raise;end if;end;
 begin delete from public.work_workspaces where id=w3;raise exception 'TEST_HARD_DELETE';exception when insufficient_privilege then if sqlerrm <> 'WORK_WORKSPACE_DELETE_FORBIDDEN' then raise;end if;end;
 insert into app_private.work_workspace_events(actor_user_id,workspace_id,kind,reason,idempotency_key) values(u,w1,'fixture','rollback invariant',gen_random_uuid());
 begin update app_private.work_workspace_events set reason='changed' where workspace_id=w1;raise exception 'TEST_AUDIT_UPDATE';exception when insufficient_privilege then if sqlerrm <> 'WORK_WORKSPACE_EVENT_APPEND_ONLY' then raise;end if;end;
 begin delete from app_private.work_workspace_events where workspace_id=w1;raise exception 'TEST_AUDIT_DELETE';exception when insufficient_privilege then if sqlerrm <> 'WORK_WORKSPACE_EVENT_APPEND_ONLY' then raise;end if;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by,starts_at) values(w2,u,'member',u,'-infinity');raise exception 'TEST_MEMBER_FINITE';exception when check_violation then null;end;
 begin update public.work_workspace_preferences set last_opened_at='infinity' where workspace_id=w1;raise exception 'TEST_PREFERENCE_FINITE';exception when check_violation then null;end;
 if exists(select 1 from pg_class where oid in('public.work_workspaces'::regclass,'public.work_workspace_members'::regclass,'public.work_workspace_preferences'::regclass,'app_private.work_workspace_events'::regclass) and not relrowsecurity) then raise exception 'TEST_RLS_DISABLED';end if;
 if exists(select 1 from unnest(array['anon','authenticated']) r cross join unnest(array['public.work_workspaces','public.work_workspace_members','public.work_workspace_preferences','app_private.work_workspace_events']) t where has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'TEST_BROWSER_TABLE_PRIVILEGES';end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform 1 from public.work_workspaces;raise exception 'TEST_BROWSER_WORKSPACE_READ';exception when insufficient_privilege then null;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by) values(gen_random_uuid(),gen_random_uuid(),'admin',gen_random_uuid());raise exception 'TEST_BROWSER_MEMBER_INSERT';exception when insufficient_privilege then null;end;
 begin update public.work_workspace_members set role='admin';raise exception 'TEST_BROWSER_MEMBER_UPDATE';exception when insufficient_privilege then null;end;
 begin delete from public.work_workspace_members;raise exception 'TEST_BROWSER_MEMBER_DELETE';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.work_workspaces;raise exception 'TEST_ANON_WORKSPACE_READ';exception when insufficient_privilege then null;end;
 begin insert into public.work_workspace_members(workspace_id,user_id,role,added_by) values(gen_random_uuid(),gen_random_uuid(),'admin',gen_random_uuid());raise exception 'TEST_ANON_MEMBER_INSERT';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select value from ws1_state where key='tasks') is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.work_tasks t)
 or (select value from ws1_state where key='assignments') is distinct from (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.work_task_assignments a)
 or (select value from ws1_state where key='calendars') is distinct from (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.work_sla_calendars c)
 or (select value from ws1_state where key='policies') is distinct from (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.work_sla_policies p)
 then raise exception 'TEST_LEGACY_BUSINESS_DATA_CHANGED';end if;
end $$;
select 'WORK_WORKSPACE_FOUNDATION_SMOKE_PASSED' as result;
rollback;
