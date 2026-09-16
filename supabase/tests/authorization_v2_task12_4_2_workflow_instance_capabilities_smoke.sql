-- Workflow lifecycle commands must require their dedicated capabilities.
-- Ownership alone must not imply cancel/reopen/administer authority.
begin;

create temporary table workflow_capability_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into workflow_capability_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-workflow-' || actor_kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values
  ('owner'),
  ('cancel_operator'),
  ('reopen_operator'),
  ('instance_admin'),
  ('outsider'),
  ('watcher_target')
) actor(actor_kind);

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 Workflow ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from workflow_capability_actor;

do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft',
      'workflow.instance.cancel',
      'workflow.instance.reopen',
      'workflow.instance.administer'
    )
      and is_active
  ) <> 5 then
    raise exception 'Workflow lifecycle capability catalog is incomplete';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft'
    )
      and (
        scope_modes <> array['own']::text[]
        or grant_readiness <> 'declared'
        or direct_grant_allowed
      )
  ) then
    raise exception 'Draft capabilities became grantable before a draft lifecycle exists';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'workflow.instance.cancel',
      'workflow.instance.reopen',
      'workflow.instance.administer'
    )
      and (
        scope_modes <> array['global']::text[]
        or grant_readiness <> 'enforced'
        or not direct_grant_allowed
      )
  ) then
    raise exception 'Enforced workflow administration capabilities have invalid metadata';
  end if;
end;
$$;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.actor_id, grant_row.permission_code, 'global', '*', true,
       'Task 12.4.2 workflow capability smoke fixture'
from workflow_capability_actor actor
join (values
  ('cancel_operator', 'workflow.instance.cancel'),
  ('reopen_operator', 'workflow.instance.reopen'),
  ('instance_admin', 'workflow.instance.administer')
) grant_row(actor_kind, permission_code)
  on grant_row.actor_kind = actor.actor_kind;

create temporary table workflow_capability_context (
  template_id uuid not null,
  node_id uuid not null,
  cancel_allowed_id uuid not null,
  cancel_owner_denied_id uuid not null,
  reopen_allowed_id uuid not null,
  reopen_owner_denied_id uuid not null,
  watcher_instance_id uuid not null
) on commit drop;

insert into workflow_capability_context
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

insert into public.workflow_templates (id, name, description, created_by, is_active)
select context_row.template_id, 'Task 12.4.2 workflow capability template',
       'Rollback-only smoke fixture', owner_actor.actor_id, true
from workflow_capability_context context_row
join workflow_capability_actor owner_actor on owner_actor.actor_kind = 'owner';

insert into public.workflow_nodes (id, template_id, type, label, config)
select node_id, template_id, 'ACTION'::public.workflow_node_type,
       'Task 12.4.2 capability node', '{}'::jsonb
from workflow_capability_context;

insert into public.workflow_instances (
  id, template_id, code, title, created_by, current_node_id, status,
  form_data, watchers, step_assignees
)
select instance_row.instance_id, context_row.template_id,
       'WF-SMOKE-' || left(instance_row.instance_id::text, 8),
       'Task 12.4.2 workflow capability instance', owner_actor.actor_id,
       context_row.node_id, instance_row.status::public.workflow_instance_status,
       '{}'::jsonb, '{}'::text[], '{}'::jsonb
from workflow_capability_context context_row
join workflow_capability_actor owner_actor on owner_actor.actor_kind = 'owner'
cross join lateral (values
  (context_row.cancel_allowed_id, 'RUNNING'),
  (context_row.cancel_owner_denied_id, 'RUNNING'),
  (context_row.reopen_allowed_id, 'COMPLETED'),
  (context_row.reopen_owner_denied_id, 'REJECTED'),
  (context_row.watcher_instance_id, 'RUNNING')
) instance_row(instance_id, status);

grant select on workflow_capability_actor to authenticated;
grant select on workflow_capability_context to authenticated;

set local role authenticated;

do $$
declare
  context_row workflow_capability_context%rowtype;
  actor workflow_capability_actor%rowtype;
  target_actor workflow_capability_actor%rowtype;
  command_result jsonb;
  blocked boolean;
begin
  select * into context_row from workflow_capability_context;

  select * into actor from workflow_capability_actor
  where actor_kind = 'cancel_operator';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  command_result := public.cancel_workflow_instance(
    context_row.cancel_allowed_id,
    'Dedicated cancel capability',
    gen_random_uuid()
  );
  if command_result #>> '{instance,status}' <> 'CANCELLED' then
    raise exception 'Dedicated cancel capability did not cancel running instance';
  end if;
  blocked := false;
  begin
    perform public.reopen_workflow_instance(
      context_row.reopen_allowed_id,
      context_row.node_id,
      'Cancel must not imply reopen',
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Cancel capability unexpectedly implied reopen capability';
  end if;

  select * into actor from workflow_capability_actor where actor_kind = 'owner';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.cancel_workflow_instance(
      context_row.cancel_owner_denied_id,
      'Ownership must not imply cancel',
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Workflow owner unexpectedly cancelled a running instance';
  end if;

  select * into actor from workflow_capability_actor
  where actor_kind = 'reopen_operator';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.cancel_workflow_instance(
      context_row.cancel_owner_denied_id,
      'Reopen must not imply cancel',
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Reopen capability unexpectedly implied cancel capability';
  end if;
  command_result := public.reopen_workflow_instance(
    context_row.reopen_allowed_id,
    context_row.node_id,
    'Dedicated reopen capability',
    gen_random_uuid()
  );
  if command_result #>> '{instance,status}' <> 'RUNNING' then
    raise exception 'Dedicated reopen capability did not reopen completed instance';
  end if;

  select * into actor from workflow_capability_actor where actor_kind = 'owner';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.reopen_workflow_instance(
      context_row.reopen_owner_denied_id,
      context_row.node_id,
      'Ownership must not imply reopen',
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Workflow owner unexpectedly reopened a rejected instance';
  end if;

  select * into target_actor from workflow_capability_actor
  where actor_kind = 'watcher_target';
  command_result := public.update_workflow_instance_watchers(
    context_row.watcher_instance_id,
    array[actor.actor_id],
    gen_random_uuid()
  );
  if command_result #> '{instance,watchers}' <> to_jsonb(array[actor.actor_id::text]) then
    raise exception 'Self watcher toggle failed';
  end if;

  blocked := false;
  begin
    perform public.update_workflow_instance_watchers(
      context_row.watcher_instance_id,
      array[actor.actor_id, target_actor.actor_id],
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Non-admin watcher unexpectedly changed another watcher';
  end if;

  select * into actor from workflow_capability_actor
  where actor_kind = 'outsider';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.update_workflow_instance_watchers(
      context_row.watcher_instance_id,
      array[actor.actor_id],
      gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then
    raise exception 'Invisible workflow outsider unexpectedly followed an instance';
  end if;

  select * into actor from workflow_capability_actor
  where actor_kind = 'instance_admin';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  command_result := public.update_workflow_instance_watchers(
    context_row.watcher_instance_id,
    array[target_actor.actor_id],
    gen_random_uuid()
  );
  if command_result #> '{instance,watchers}' <> to_jsonb(array[target_actor.actor_id::text]) then
    raise exception 'Workflow instance admin did not replace watcher set';
  end if;
end;
$$;

reset role;

do $$
declare
  context_row workflow_capability_context%rowtype;
begin
  select * into context_row from workflow_capability_context;
  if not exists (
    select 1 from public.workflow_instances
    where id = context_row.cancel_allowed_id and status = 'CANCELLED'
  ) or not exists (
    select 1 from public.workflow_instances
    where id = context_row.cancel_owner_denied_id and status = 'RUNNING'
  ) or not exists (
    select 1 from public.workflow_instances
    where id = context_row.reopen_allowed_id and status = 'RUNNING'
  ) or not exists (
    select 1 from public.workflow_instances
    where id = context_row.reopen_owner_denied_id and status = 'REJECTED'
  ) then
    raise exception 'Workflow capability command smoke persisted an unexpected status set';
  end if;
end;
$$;

rollback;
