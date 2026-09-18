-- Cloud-only rollback smoke for the running workflow content guard.
begin;

create temporary table workflow_mutation_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into workflow_mutation_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-workflow-mutation-' || actor_kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('owner'), ('assigned'), ('instance_admin'), ('outsider')) actor(actor_kind);

insert into public.users (id, name, email, username, role, is_active, account_status)
select actor_id, 'Workflow mutation ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from workflow_mutation_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor_id, 'workflow.instance.administer', 'global', '*', true,
       'Task 12.4.2 workflow mutation smoke fixture'
from workflow_mutation_actor
where actor_kind = 'instance_admin';

create temporary table workflow_mutation_context (
  template_id uuid not null,
  node_id uuid not null,
  instance_id uuid not null
) on commit drop;

insert into workflow_mutation_context values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into public.workflow_templates (id, name, description, created_by, is_active)
select context.template_id, 'Workflow mutation guard template', 'Rollback-only fixture',
       owner_actor.actor_id, true
from workflow_mutation_context context
join workflow_mutation_actor owner_actor on owner_actor.actor_kind = 'owner';

insert into public.workflow_nodes (id, template_id, type, label, config)
select node_id, template_id, 'ACTION'::public.workflow_node_type,
       'Assigned action', '{}'::jsonb
from workflow_mutation_context;

insert into public.workflow_instances (
  id, template_id, code, title, created_by, current_node_id, status,
  form_data, watchers, step_assignees
)
select context.instance_id, context.template_id,
       'WF-MUT-' || left(context.instance_id::text, 8), 'Original title',
       owner_actor.actor_id, context.node_id, 'RUNNING',
       jsonb_build_object('note', 'protected', 'step_' || context.node_id::text || '_value', 'before'),
       '{}'::text[],
       jsonb_build_object(context.node_id::text, jsonb_build_array(assigned_actor.actor_id))
from workflow_mutation_context context
join workflow_mutation_actor owner_actor on owner_actor.actor_kind = 'owner'
join workflow_mutation_actor assigned_actor on assigned_actor.actor_kind = 'assigned';

grant select on workflow_mutation_actor, workflow_mutation_context to authenticated;

set local role authenticated;

do $$
declare
  context workflow_mutation_context%rowtype;
  actor workflow_mutation_actor%rowtype;
  result jsonb;
  next_form jsonb;
  blocked boolean;
  step_key text;
begin
  select * into context from workflow_mutation_context;
  step_key := 'step_' || context.node_id::text || '_value';

  if has_table_privilege('authenticated', 'public.workflow_instances', 'UPDATE')
     or has_table_privilege('authenticated', 'public.workflow_instances', 'DELETE')
     or has_table_privilege('authenticated', 'public.workflow_instance_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.workflow_instance_logs', 'DELETE') then
    raise exception 'Authenticated still has direct workflow mutation privileges';
  end if;

  select * into actor from workflow_mutation_actor where actor_kind = 'owner';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.update_workflow_instance_content(
      context.instance_id, null, jsonb_build_object('note', 'owner edit'), gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Creator edited a running instance without assignment'; end if;

  select * into actor from workflow_mutation_actor where actor_kind = 'assigned';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  select form_data || jsonb_build_object(step_key, 'after') into next_form
  from public.workflow_instances where id = context.instance_id;
  result := public.update_workflow_instance_content(
    context.instance_id, null, next_form, gen_random_uuid()
  );
  if result #>> array['instance', 'form_data', step_key] <> 'after' then
    raise exception 'Current assignee could not update its current-step data';
  end if;

  blocked := false;
  begin
    perform public.update_workflow_instance_content(
      context.instance_id, 'Assigned changed title', null, gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Assigned actor changed instance title'; end if;

  blocked := false;
  begin
    select form_data || jsonb_build_object('note', 'assigned changed protected field') into next_form
    from public.workflow_instances where id = context.instance_id;
    perform public.update_workflow_instance_content(
      context.instance_id, null, next_form, gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Assigned actor changed non-step instance data'; end if;

  select * into actor from workflow_mutation_actor where actor_kind = 'outsider';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.update_workflow_instance_content(
      context.instance_id, null, jsonb_build_object(step_key, 'outsider'), gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Outsider edited assigned-step data'; end if;

  select * into actor from workflow_mutation_actor where actor_kind = 'instance_admin';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  select form_data || jsonb_build_object('note', 'admin changed protected field') into next_form
  from public.workflow_instances where id = context.instance_id;
  result := public.update_workflow_instance_content(
    context.instance_id, 'Admin title', next_form, gen_random_uuid()
  );
  if result #>> '{instance,title}' <> 'Admin title'
     or result #>> '{instance,form_data,note}' <> 'admin changed protected field' then
    raise exception 'Instance administrator could not update instance-level content';
  end if;
end;
$$;

reset role;
select 'authorization_v2_task12_4_2_workflow_running_mutation_guard_smoke_passed' as result;
rollback;
