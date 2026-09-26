begin;
do $$
declare
 a public.users%rowtype; outsider public.users%rowtype;
 project_id text; other_project_id text;
 template_id uuid:=gen_random_uuid(); n1 uuid:=gen_random_uuid(); n2 uuid:=gen_random_uuid(); n3 uuid:=gen_random_uuid(); inst uuid:=gen_random_uuid();
 result jsonb; cloned uuid; watchers text[]; denied boolean; source_count integer;
begin
 select * into a from public.users where role='ADMIN' and is_active and account_status='ACTIVE' and auth_id is not null limit 1;
 insert into public.users(id,name,email,username,role,is_active,account_status) values(gen_random_uuid(),'Rollback outsider','safety-'||gen_random_uuid()::text||'@vioo.local','safety-'||gen_random_uuid()::text,'EMPLOYEE',true,'ACTIVE') returning * into outsider;
 outsider.auth_id:=gen_random_uuid();
 select id into project_id from public.projects order by created_at limit 1;
 select id into other_project_id from public.projects where id<>project_id limit 1;
 if a.id is null or outsider.id is null or other_project_id is null then raise exception 'Missing smoke prerequisites'; end if;
 insert into public.workflow_templates(id,name,created_by,is_active) values(template_id,'Safety rollback fixture',a.id,true);
 insert into public.workflow_nodes(id,template_id,type,label,config) values
 (n1,template_id,'START','Start','{}'),
 (n2,template_id,'APPROVAL','Review',jsonb_build_object('approvalPolicy','ANY_ONE','stepWatcherTargets',jsonb_build_array(jsonb_build_object('type','user','userId',outsider.id),jsonb_build_object('type','user','userId',repeat('-',36))))),
 (n3,template_id,'END','End','{}');
 insert into public.workflow_edges(template_id,source_node_id,target_node_id) values(template_id,n1,n2),(template_id,n2,n3);
 insert into public.workflow_instances(id,template_id,code,title,created_by,current_node_id,status,watchers) values(inst,template_id,'SAFE-'||inst::text,'Rollback watcher test',a.id,n1,'DRAFT',array[a.id::text]);
 update public.workflow_instances set current_node_id=n2 where id=inst;
 select wi.watchers into watchers from public.workflow_instances wi where wi.id=inst;
 if not (a.id::text=any(watchers) and outsider.id::text=any(watchers)) or cardinality(watchers)<>2 then raise exception 'Watcher merge failed'; end if;
 update public.workflow_instances set current_node_id=n3 where id=inst;
 if (select cardinality(wi.watchers) from public.workflow_instances wi where wi.id=inst)<>2 then raise exception 'Watchers were removed'; end if;
 update public.workflow_nodes set config='{"stepWatcherTargets":null}' where id=n2;
 update public.workflow_instances set current_node_id=n2 where id=inst;
 update public.workflow_nodes set config='{"stepWatcherTargets":{"bad":true}}' where id=n2;
 if cardinality(app_private.workflow_resolve_step_watchers(n2))<>0 then raise exception 'Malformed config not ignored'; end if;
 perform set_config('request.jwt.claim.sub',a.auth_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.auth_id,'role','authenticated')::text,true);
 result:=public.clone_project_workflow_template('material_request',project_id,template_id);
 cloned:=(result->'template'->>'id')::uuid;
 if not (result->>'cloned')::boolean or not (result->'validation'->>'valid')::boolean then raise exception 'Clone failed'; end if;
 if (select count(*) from public.workflow_nodes where workflow_nodes.template_id=cloned)<>3 or (select count(*) from public.workflow_edges where workflow_edges.template_id=cloned)<>2 then raise exception 'Graph remapping failed'; end if;
 result:=public.clone_project_workflow_template('material_request',project_id,template_id);
 if (result->>'cloned')::boolean or (result->'template'->>'id')::uuid<>cloned then raise exception 'Clone is not idempotent'; end if;
 denied:=false;
 begin perform public.set_project_workflow_binding('material_request',cloned,other_project_id,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Cross-project binding was allowed'; end if;
 result:=public.get_project_workflow_configuration('material_request',project_id,null);
 if (result->>'templateOwnedByProject')::boolean is not true then raise exception 'Ownership metadata incorrect'; end if;
 perform set_config('request.jwt.claim.sub',outsider.auth_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider.auth_id,'email',outsider.email,'role','authenticated')::text,true);
 denied:=false;
 begin perform public.clone_project_workflow_template('material_request',project_id,template_id); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unauthorized clone allowed'; end if;
 if not app_private.workflow_template_actor_can_view(cloned,outsider.id) then
  denied:=false;
  begin perform public.get_project_workflow_configuration('material_request',project_id,null); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Unauthorized configuration read allowed'; end if;
 else raise exception 'Outsider fixture unexpectedly has workflow view'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('workflow_resolve_step_watchers','workflow_instance_autotag_step_watchers','project_owned_workflow_actor_has_room_action') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))) then raise exception 'Private helper exposed'; end if;
 if has_function_privilege('anon','public.clone_project_workflow_template(text,text,uuid)','EXECUTE') then raise exception 'Anon clone exposed'; end if;
end $$;

create temporary table safety_role_context as
select p.id as project_id, u.auth_id as admin_auth_id,
 (select t.id from public.workflow_templates t where t.owner_project_id is null and (app_private.project_workflow_validate_template(t.id)->>'valid')::boolean limit 1) as source_id,
 gen_random_uuid() as outsider_id,
 'safety-role-'||gen_random_uuid()::text||'@vioo.local' as outsider_email
from public.projects p cross join public.users u
where u.role='ADMIN' and u.is_active and u.account_status='ACTIVE' and u.auth_id is not null limit 1;
insert into public.users(id,name,email,username,role,is_active,account_status)
select outsider_id,'Rollback role check',outsider_email,outsider_email,'EMPLOYEE',true,'ACTIVE' from safety_role_context;
grant select on safety_role_context to authenticated;
select set_config('request.jwt.claim.sub',admin_auth_id::text,true), set_config('request.jwt.claims',jsonb_build_object('sub',admin_auth_id,'role','authenticated')::text,true) from safety_role_context;
set local role authenticated;
do $$ declare c record; r jsonb; begin
 select * into c from safety_role_context;
 r:=public.clone_project_workflow_template('material_request',c.project_id,c.source_id);
 if not (r->'validation'->>'valid')::boolean then raise exception 'Authenticated clone failed'; end if;
 r:=public.get_project_workflow_configuration('material_request',c.project_id,null);
 if not (r->>'canCustomize')::boolean then raise exception 'Authenticated config failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true), set_config('request.jwt.claims',jsonb_build_object('email',outsider_email,'role','authenticated')::text,true) from safety_role_context;
set local role authenticated;
do $$ declare c record; denied boolean:=false; begin
 select * into c from safety_role_context;
 begin perform public.clone_project_workflow_template('material_request',c.project_id,c.source_id); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated outsider cloned'; end if;
 denied:=false;
 begin perform public.get_project_workflow_configuration('material_request',c.project_id,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated outsider read config'; end if;
 denied:=false;
 begin perform app_private.workflow_resolve_step_watchers(gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated called private helper'; end if;
end $$;
reset role;

rollback;
