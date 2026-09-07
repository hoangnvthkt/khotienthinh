begin;
do $$ begin
 if to_regprocedure('public.create_work_workspace(jsonb,uuid)') is null then raise exception 'WORK_WORKSPACE_MEMBERSHIP_MISSING';end if;
end $$;
create temp table ws2_people(name text primary key,id uuid,email text) on commit drop;
create temp table ws2_data(key text primary key,value jsonb) on commit drop;
grant select on ws2_people to authenticated;
grant select,insert,update on ws2_data to authenticated;
insert into ws2_people select n,gen_random_uuid(),'ws2-'||gen_random_uuid()||'@invalid.local' from unnest(array['admin','member','outsider','expired','disabled','recovery','second_admin']) n;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,name,'ws2-'||id,email,(case when name='outsider' then 'ADMIN' else 'EMPLOYEE' end)::public.user_role,true,'ACTIVE' from ws2_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.workspace.create','global','*','rollback fixture' from ws2_people where name='admin';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','rollback fixture' from ws2_people where name in('admin','outsider','recovery');
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason,expires_at)
select id,'work.workspace.recover','global','*','rollback fixture',now()+interval '1 hour' from ws2_people where name='recovery';
with d as (insert into public.org_units(name) values('WS2 source A'),('WS2 source B'),('WS2 source legacy calendar') returning id,name)
insert into ws2_data select name,to_jsonb(id) from d;
insert into public.work_sla_calendars(name,scope_type,department_id,working_weekdays,workday_start,workday_end,created_by)
select 'WS2 legacy calendar','department',(select (value#>>'{}')::uuid from ws2_data where key='WS2 source legacy calendar'),array[1,2,3,4,5]::smallint[],'08:00','17:00',id from ws2_people where name='admin';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws2_people where name='admin';
do $$ declare r jsonb;r2 jsonb;k uuid:=gen_random_uuid();input jsonb:='{"kind":"collaboration","name":"WS2 rollback workspace","iconKey":"users","colorKey":"blue","coverKey":"grid"}';begin
 if public.current_app_user_id() is distinct from(select id from ws2_people where name='admin') then raise exception 'TEST_IDENTITY';end if;
 r:=public.create_work_workspace(input,k);r2:=public.create_work_workspace(input,k);
 if r is distinct from r2 or r->>'id' is null then raise exception 'TEST_CREATE_REPLAY %',r;end if;
 insert into ws2_data values('workspace',r),('key',to_jsonb(k));
 begin perform public.create_work_workspace(input||'{"name":"Other payload"}',k);raise exception 'TEST_REUSED_KEY';exception when sqlstate 'P0001' then if sqlerrm not like '%IDEMPOTENCY%' then raise;end if;end;
 if not (r->'capabilities'->>'canManageMembers')::boolean then raise exception 'TEST_CREATOR_ADMIN';end if;
end $$;
reset role;
insert into public.work_workspace_members(workspace_id,user_id,role,added_by,starts_at,expires_at)
select (select (value->>'id')::uuid from ws2_data where key='workspace'),id,case when name='second_admin' then 'admin' else 'member' end,
(select id from ws2_people where name='admin'),now()-interval '2 hours',case when name='expired' then now()-interval '1 hour' else null end
from ws2_people where name in('member','expired','disabled','second_admin');
-- Rollback-only trusted account lifecycle simulation for the synthetic user.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('app.account_lifecycle_command','on',true);
update public.users set account_status='DISABLED' where id=(select id from ws2_people where name='disabled');
do $$ declare w text:=(select value->>'id' from ws2_data where key='workspace');u uuid;begin
 select id into u from ws2_people where name='member';
 if not app_private.has_permission(u,'work.task.create','work_workspace',w) then raise exception 'TEST_MEMBER_CREATE';end if;
 if not app_private.has_permission(u,'work.module.access','global','*') then raise exception 'TEST_MEMBER_MODULE';end if;
 if app_private.has_permission(u,'work.task.configure','work_workspace',w) or app_private.has_permission(u,'work.task.view_restricted','work_workspace',w) or app_private.has_permission(u,'work.task.assign_group','work_workspace',w) then raise exception 'TEST_MEMBER_OVERGRANT';end if;
 if app_private.has_permission(u,'work.task.create','work_workspace',gen_random_uuid()::text) or app_private.has_permission(u,'work.task.create','own','*') then raise exception 'TEST_SCOPE_LEAK';end if;
 if exists(select 1 from ws2_people p where p.name in('outsider','expired','disabled') and app_private.has_permission(p.id,'work.task.create','work_workspace',w)) then raise exception 'TEST_NONMEMBER_GRANT';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws2_people where name='member';
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');s jsonb;r jsonb;begin
 s:=public.get_my_authorization_snapshot();
 if not exists(select 1 from jsonb_array_elements(s->'sources') x where x->>'sourceType'='WORKSPACE_MEMBER' and x->>'permissionCode'='work.task.create' and x->>'scopeId'=w::text) then raise exception 'TEST_SNAPSHOT_PARITY';end if;
 r:=public.get_work_workspace(w);
 if r->>'id' is distinct from w::text or (r->'capabilities'->>'canManageMembers')::boolean then raise exception 'TEST_MEMBER_SUMMARY';end if;
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',public.current_app_user_id(),'role','admin')));raise exception 'TEST_SELF_PROMOTION';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws2_people where name='outsider';
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');begin
 begin perform public.get_work_workspace(w);raise exception 'TEST_OUTSIDER_READ';exception when insufficient_privilege then null;end;
 begin perform public.create_work_workspace('{"kind":"project","projectId":"unknown-private-project","name":"No source probe","iconKey":"folder","colorKey":"blue","coverKey":"plain"}',gen_random_uuid());raise exception 'TEST_SOURCE_PROBE';exception when insufficient_privilege then if sqlerrm<>'WORK_WORKSPACE_CREATE_DENIED' then raise;end if;end;
 begin perform public.create_work_workspace('{"kind":"collaboration","name":"Legacy admin denied","iconKey":"users","colorKey":"blue","coverKey":"plain"}',gen_random_uuid());raise exception 'TEST_LEGACY_ADMIN_CREATE';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws2_people where name='admin';
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');p jsonb;r jsonb;r2 jsonb;v bigint;k uuid:=gen_random_uuid();begin
 v:=(public.get_work_workspace(w)->>'lockVersion')::bigint;
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','add','userId',(select id from ws2_people where name='outsider'),'role','member','expiresAt',now()+interval '1 hour')));
 if jsonb_array_length(p->'blockers')<>0 or nullif(p->>'fingerprint','') is null then raise exception 'TEST_ADD_PREVIEW %',p;end if;
 r:=public.apply_work_workspace_members(w,p,v,'Rollback invitation',k);
 r2:=public.apply_work_workspace_members(w,p,v,'Rollback invitation',k);
 if r is distinct from r2 or (r->>'lockVersion')::bigint<=v then raise exception 'TEST_MEMBERSHIP_REPLAY %',r;end if;
 insert into ws2_data values('applied',r),('preview',p),('apply_key',to_jsonb(k));
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','remove','userId',(select id from ws2_people where name='admin')),jsonb_build_object('operation','remove','userId',(select id from ws2_people where name='second_admin'))));
 if jsonb_array_length(p->'blockers')=0 then raise exception 'TEST_LAST_ADMIN_PREVIEW %',p;end if;
 begin perform public.apply_work_workspace_members(w,p,(r->>'lockVersion')::bigint,'Cannot remove last admin',gen_random_uuid());raise exception 'TEST_LAST_ADMIN_APPLY';exception when sqlstate 'P0001' or insufficient_privilege then if sqlerrm not like 'WORK_%' then raise;end if;end;
 -- A foreign workspace must be denied even to an administrator of this one.
 begin perform public.preview_work_workspace_members(gen_random_uuid(),'[]');raise exception 'TEST_ADMIN_CROSS_WORKSPACE';exception when insufficient_privilege then null;end;
 -- Explicit false pins; opening does not erase the saved pin.
 perform public.set_work_workspace_preference(w,true,false);
 perform public.set_work_workspace_preference(w,null,true);
 if not (public.get_work_workspace(w)->>'pinned')::boolean then raise exception 'TEST_PIN_PRESERVED';end if;
end $$;
reset role;
set local role authenticated;
do $$ declare first_page jsonb;second_page jsonb;members_page jsonb;second_members jsonb;w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');begin
 perform public.create_work_workspace('{"kind":"collaboration","name":"WS2 pagination B","iconKey":"users","colorKey":"teal","coverKey":"plain"}',gen_random_uuid());
 perform public.create_work_workspace('{"kind":"collaboration","name":"WS2 pagination C","iconKey":"users","colorKey":"violet","coverKey":"plain"}',gen_random_uuid());
 first_page:=public.list_my_work_workspaces(p_search=>'WS2',p_limit=>1);
 if jsonb_array_length(first_page->'items')<>1 or first_page->>'nextCursor' is null then raise exception 'TEST_WORKSPACE_PAGE_ONE %',first_page;end if;
 second_page:=public.list_my_work_workspaces(p_search=>'WS2',p_cursor=>first_page->'nextCursor',p_limit=>1);
 if jsonb_array_length(second_page->'items')<>1 or first_page->'items'->0->>'id'=second_page->'items'->0->>'id' then raise exception 'TEST_WORKSPACE_PAGE_TWO %',second_page;end if;
 first_page:=public.list_my_work_workspaces(p_search=>'WS2',p_pinned_only=>true,p_sort=>'recent',p_limit=>1);
 if first_page->'items'->0->>'id' is distinct from w::text then raise exception 'TEST_PIN_SECTION';end if;
 members_page:=public.list_work_workspace_members(p_workspace_id=>w,p_limit=>1);
 second_members:=public.list_work_workspace_members(p_workspace_id=>w,p_cursor=>members_page->'nextCursor',p_limit=>1);
 if members_page->>'nextCursor' is null or members_page->'items'->0->>'userId'=second_members->'items'->0->>'userId' then raise exception 'TEST_MEMBER_PAGE';end if;
 begin perform public.list_my_work_workspaces(p_limit=>51);raise exception 'TEST_WORKSPACE_LIMIT';exception when invalid_parameter_value then null;end;
 begin perform public.list_my_work_workspaces(p_search=>repeat('a',101));raise exception 'TEST_SEARCH_LIMIT';exception when invalid_parameter_value then null;end;
 begin perform public.list_my_work_workspaces(p_cursor=>'{"id":"wrong","sortAt":"now"}');raise exception 'TEST_BAD_CURSOR';exception when invalid_parameter_value then null;end;
end $$;
reset role;
set local role authenticated;
do $$ declare a jsonb;b jsonb;r jsonb;w uuid;d uuid:=(select (value#>>'{}')::uuid from ws2_data where key='WS2 source A');begin
 a:=public.list_work_workspace_sources(p_kind=>'department',p_search=>'WS2 source',p_limit=>1);
 b:=public.list_work_workspace_sources(p_kind=>'department',p_search=>'WS2 source',p_cursor=>a->'nextCursor',p_limit=>1);
 if a->>'nextCursor' is null or a->'items'->0->>'id'=b->'items'->0->>'id' then raise exception 'TEST_SOURCE_PAGE % %',a,b;end if;
 r:=public.create_work_workspace(jsonb_build_object('kind','department','departmentId',d,'name','WS2 linked workspace','iconKey','building','colorKey','blue','coverKey','plain'),gen_random_uuid());
 w:=(r->>'id')::uuid;
 a:=public.list_work_workspace_sources(p_kind=>'department',p_search=>'WS2 source A',p_limit=>1);
 if a->'items'->0->>'existingWorkspaceId' is distinct from w::text then raise exception 'TEST_SOURCE_EXISTING_LINK';end if;
 begin perform public.create_work_workspace(jsonb_build_object('kind','department','departmentId',d,'name','Duplicate source','iconKey','building','colorKey','blue','coverKey','plain'),gen_random_uuid());raise exception 'TEST_DUPLICATE_SOURCE';exception when unique_violation then null;end;
 begin perform public.create_work_workspace(jsonb_build_object('kind','department','departmentId',(select value#>>'{}' from ws2_data where key='WS2 source legacy calendar'),'name','Must migrate first','iconKey','building','colorKey','blue','coverKey','plain'),gen_random_uuid());raise exception 'TEST_LEGACY_CALENDAR_GUARD';exception when object_not_in_prerequisite_state then if sqlerrm<>'WORK_WORKSPACE_MIGRATION_REQUIRED' then raise;end if;end;
 insert into ws2_data values('linked_workspace',to_jsonb(w));
end $$;
reset role;
-- Open assignments/reviews prevent removal and archive in the linked Workspace.
insert into public.work_workspace_members(workspace_id,user_id,role,added_by)
select (select (value#>>'{}')::uuid from ws2_data where key='linked_workspace'),id,'member',(select id from ws2_people where name='admin') from ws2_people where name='member';
with t as (insert into public.work_tasks(task_code,title,scope_type,department_id,workspace_id,created_by,reviewer_user_id)
select app_private.next_work_task_code(),'WS2 rollback open responsibility','department',(select (value#>>'{}')::uuid from ws2_data where key='WS2 source A'),(select (value#>>'{}')::uuid from ws2_data where key='linked_workspace'),(select id from ws2_people where name='admin'),id from ws2_people where name='member' returning id)
insert into public.work_task_assignments(task_id,user_id,assigned_by) select t.id,p.id,(select id from ws2_people where name='admin') from t cross join ws2_people p where p.name='member';
set local role authenticated;
do $$ declare w uuid:=(select (value#>>'{}')::uuid from ws2_data where key='linked_workspace');p jsonb;begin
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','remove','userId',(select id from ws2_people where name='member'))));
 if not exists(select 1 from jsonb_array_elements(p->'blockers') x where (x->>'openAssignmentCount')::int=1 and (x->>'openReviewCount')::int=1) then raise exception 'TEST_OPEN_RESPONSIBILITY_PREVIEW %',p;end if;
 begin perform public.apply_work_workspace_members(w,p,1,'Cannot remove open responsibility',gen_random_uuid());raise exception 'TEST_OPEN_RESPONSIBILITY_APPLY';exception when sqlstate 'P0001' or insufficient_privilege then if sqlerrm not like 'WORK_%' then raise;end if;end;
 begin perform public.command_work_workspace(w,'archive','{}',1,'Cannot archive open work',gen_random_uuid());raise exception 'TEST_ARCHIVE_OPEN_WORK';exception when sqlstate 'P0001' or insufficient_privilege then if sqlerrm not like 'WORK_%' then raise;end if;end;
end $$;
reset role;
set local role authenticated;
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');v bigint;k uuid:=gen_random_uuid();r jsonb;begin
 v:=(public.get_work_workspace(w)->>'lockVersion')::bigint;
 r:=public.command_work_workspace(w,'archive','{}',v,'Archive empty rollback workspace',k);
 if r->>'status'<>'archived' or (r->'capabilities'->>'canCreateTask')::boolean or not (r->'capabilities'->>'canArchive')::boolean then raise exception 'TEST_ARCHIVED_CAPABILITIES %',r;end if;
 if public.command_work_workspace(w,'archive','{}',v,'Archive empty rollback workspace',k) is distinct from r then raise exception 'TEST_ARCHIVE_REPLAY';end if;
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','remove','userId',(select id from ws2_people where name='member'))));raise exception 'TEST_ARCHIVED_MEMBERSHIP';exception when insufficient_privilege then null;end;
 r:=public.command_work_workspace(w,'restore','{}',(r->>'lockVersion')::bigint,'Restore rollback workspace',gen_random_uuid());
 if r->>'status'<>'active' then raise exception 'TEST_RESTORE';end if;
end $$;
reset role;
set local role authenticated;
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');p jsonb;begin
 p:=public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',(select id from ws2_people where name='member'),'role','admin')));
 insert into ws2_data values('stale_preview',p),('stale_version',(public.get_work_workspace(w)->'lockVersion'));
 begin perform public.apply_work_workspace_members(w,p,0,'Wrong version',gen_random_uuid());raise exception 'TEST_VERSION_CONFLICT';exception when sqlstate 'P0001' then if sqlerrm<>'WORK_VERSION_CONFLICT' then raise;end if;end;
 begin perform public.apply_work_workspace_members(w,(select value from ws2_data where key='preview'),1,'Different key payload',(select (value#>>'{}')::uuid from ws2_data where key='apply_key'));raise exception 'TEST_APPLY_KEY_CONFLICT';exception when sqlstate 'P0001' then if sqlerrm<>'WORK_IDEMPOTENCY_CONFLICT' then raise;end if;end;
end $$;
reset role;
update public.work_workspace_members set lock_version=lock_version+1
where workspace_id=(select (value->>'id')::uuid from ws2_data where key='workspace') and user_id=(select id from ws2_people where name='member');
set local role authenticated;
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');begin
 begin perform public.apply_work_workspace_members(w,(select value from ws2_data where key='stale_preview'),(select (value#>>'{}')::bigint from ws2_data where key='stale_version'),'Stale member snapshot',gen_random_uuid());raise exception 'TEST_STALE_MEMBERSHIP';exception when sqlstate 'P0001' then if sqlerrm<>'WORK_MEMBERSHIP_PREVIEW_STALE' then raise;end if;end;
end $$;
reset role;
-- An expiring administrator cannot extend membership past their own authority.
update public.work_workspace_members set expires_at=now()+interval '2 hours'
where workspace_id=(select (value->>'id')::uuid from ws2_data where key='workspace') and user_id=(select id from ws2_people where name='admin');
set local role authenticated;
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');begin
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',(select id from ws2_people where name='member'),'role','admin','expiresAt',now()+interval '3 hours')));raise exception 'TEST_EXPIRY_ESCALATION';exception when insufficient_privilege then null;end;
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',(select id from ws2_people where name='member'),'role','admin','expiresAt',null)));raise exception 'TEST_NULL_EXPIRY_ESCALATION';exception when insufficient_privilege then null;end;
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','set_role','userId',(select id from ws2_people where name='expired'),'role','admin')));raise exception 'TEST_EXPIRED_ADMIN_COUNT';exception when invalid_parameter_value or insufficient_privilege then null;end;
 begin perform public.preview_work_workspace_members(w,jsonb_build_array(jsonb_build_object('operation','remove','userId',(select lower(id::text) from ws2_people where name='member')),jsonb_build_object('operation','remove','userId',(select upper(id::text) from ws2_people where name='member'))));raise exception 'TEST_UUID_ALIAS_DUPLICATE';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update public.work_workspace_members set expires_at=null
where workspace_id=(select (value->>'id')::uuid from ws2_data where key='workspace') and user_id=(select id from ws2_people where name='admin');
-- Replaying a committed mutation after leaving cannot restore access.
update public.work_workspace_members set status='removed' where workspace_id=(select (value->>'id')::uuid from ws2_data where key='workspace') and user_id=(select id from ws2_people where name='admin');
set local role authenticated;
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');begin
 begin perform public.apply_work_workspace_members(w,(select value from ws2_data where key='preview'),1,'Rollback invitation',(select (value#>>'{}')::uuid from ws2_data where key='apply_key'));raise exception 'TEST_REPLAY_AFTER_REMOVAL';exception when insufficient_privilege then null;end;
 begin perform public.recover_work_workspace_admin(w,public.current_app_user_id(),'Unauthorized recovery',gen_random_uuid());raise exception 'TEST_RECOVERY_NO_CAPABILITY';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Recovery is separately authorized and does not grant task visibility to its actor.
update public.work_workspace_members set status='removed' where workspace_id=(select (value->>'id')::uuid from ws2_data where key='workspace') and role='admin';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from ws2_people where name='recovery';
do $$ declare w uuid:=(select (value->>'id')::uuid from ws2_data where key='workspace');k uuid:=gen_random_uuid();r jsonb;begin
 r:=public.recover_work_workspace_admin(w,(select id from ws2_people where name='admin'),'Recover synthetic workspace',k);
 if public.recover_work_workspace_admin(w,(select id from ws2_people where name='admin'),'Recover synthetic workspace',k) is distinct from r then raise exception 'TEST_RECOVERY_REPLAY';end if;
 begin perform public.get_work_workspace(w);raise exception 'TEST_RECOVERY_READ_LEAK';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'WORK_WORKSPACE_MEMBERSHIP_SMOKE_PASSED' as result;
rollback;
