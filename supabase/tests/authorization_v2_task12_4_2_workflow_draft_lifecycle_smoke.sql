-- Cloud-only rollback smoke for the generic Workflow draft lifecycle.
begin;

do $$
begin
  if not exists (
    select 1
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    join pg_namespace enum_schema on enum_schema.oid = enum_type.typnamespace
    where enum_schema.nspname = 'public'
      and enum_type.typname = 'workflow_instance_status'
      and enum_value.enumlabel = 'DRAFT'
  ) then
    raise exception 'Workflow DRAFT status is missing';
  end if;

  if (
    select count(*)
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname in (
        'create_workflow_instance_draft',
        'update_workflow_instance_draft',
        'delete_workflow_instance_draft',
        'submit_workflow_instance_draft'
      )
  ) <> 4 then
    raise exception 'Workflow draft commands are incomplete';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft'
    )
      and (grant_readiness <> 'enforced' or not direct_grant_allowed)
  ) then
    raise exception 'Workflow draft capabilities are not enforced/grantable';
  end if;
end;
$$;

create temporary table workflow_draft_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into workflow_draft_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-workflow-draft-' || actor_kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('owner'), ('other'), ('assignee')) actor(actor_kind);

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Workflow draft ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from workflow_draft_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.actor_id, capability.permission_code, capability.scope_type,
       case when capability.scope_type = 'own' then actor.actor_id::text else '*' end,
       true, 'Task 12.4.2 workflow draft smoke fixture'
from workflow_draft_actor actor
cross join (values
  ('workflow.instance.create', 'global'),
  ('workflow.instance.edit_own_draft', 'own'),
  ('workflow.instance.delete_own_draft', 'own')
) capability(permission_code, scope_type)
where actor.actor_kind in ('owner', 'other');

create temporary table workflow_draft_context (
  template_id uuid not null,
  start_node_id uuid not null,
  action_node_id uuid not null
) on commit drop;

insert into workflow_draft_context values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into public.workflow_templates (id, name, description, created_by, is_active)
select context.template_id, 'Workflow draft lifecycle template', 'Rollback-only fixture',
       owner_actor.actor_id, true
from workflow_draft_context context
join workflow_draft_actor owner_actor on owner_actor.actor_kind = 'owner';

insert into public.workflow_nodes (id, template_id, type, label, config)
select context.start_node_id, context.template_id, 'START'::public.workflow_node_type, 'Start', '{}'::jsonb
from workflow_draft_context context
union all
select context.action_node_id, context.template_id, 'ACTION'::public.workflow_node_type, 'First action', '{}'::jsonb
from workflow_draft_context context;

insert into public.workflow_edges (template_id, source_node_id, target_node_id, label)
select template_id, start_node_id, action_node_id, 'Submit'
from workflow_draft_context;

grant select on workflow_draft_actor, workflow_draft_context to authenticated;

set local role authenticated;

do $$
declare
  context workflow_draft_context%rowtype;
  owner_actor workflow_draft_actor%rowtype;
  other_actor workflow_draft_actor%rowtype;
  assignee_actor workflow_draft_actor%rowtype;
  create_key uuid := gen_random_uuid();
  create_result jsonb;
  replay_result jsonb;
  update_result jsonb;
  submit_result jsonb;
  delete_result jsonb;
  draft_id uuid;
  delete_draft_id uuid;
  blocked boolean;
begin
  select * into context from workflow_draft_context;
  select * into owner_actor from workflow_draft_actor where actor_kind = 'owner';
  select * into other_actor from workflow_draft_actor where actor_kind = 'other';
  select * into assignee_actor from workflow_draft_actor where actor_kind = 'assignee';

  if has_table_privilege('authenticated', 'public.workflow_instances', 'INSERT')
     or has_table_privilege('authenticated', 'public.workflow_instance_logs', 'INSERT') then
    raise exception 'Authenticated retains direct workflow insert privileges';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', owner_actor.auth_id, 'email', owner_actor.email, 'role', 'authenticated'
  )::text, true);
  create_result := public.create_workflow_instance_draft(
    jsonb_build_object(
      'templateId', context.template_id,
      'title', 'Draft title',
      'formData', jsonb_build_object('note', 'draft note'),
      'initialAssigneeUserIds', jsonb_build_array(assignee_actor.actor_id)
    ),
    create_key
  );
  replay_result := public.create_workflow_instance_draft(
    jsonb_build_object(
      'templateId', context.template_id,
      'title', 'Draft title',
      'formData', jsonb_build_object('note', 'draft note'),
      'initialAssigneeUserIds', jsonb_build_array(assignee_actor.actor_id)
    ),
    create_key
  );
  draft_id := (create_result #>> '{instance,id}')::uuid;
  if draft_id is null
     or replay_result #>> '{instance,id}' <> draft_id::text
     or create_result #>> '{instance,status}' <> 'DRAFT'
     or create_result #>> '{instance,current_node_id}' is not null
     or exists (
       select 1 from public.workflow_instance_logs log_row
       where log_row.instance_id = draft_id
     ) then
    raise exception 'Draft creation/idempotency invariant failed';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', other_actor.auth_id, 'email', other_actor.email, 'role', 'authenticated'
  )::text, true);
  blocked := false;
  begin
    perform public.update_workflow_instance_draft(
      draft_id, 'Other title', '{}'::jsonb, null, gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Non-owner updated another user draft'; end if;

  blocked := false;
  begin
    perform public.delete_workflow_instance_draft(draft_id, gen_random_uuid());
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Non-owner deleted another user draft'; end if;

  blocked := false;
  begin
    perform public.submit_workflow_instance_draft(
      draft_id, array[assignee_actor.actor_id], gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Non-owner submitted another user draft'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', owner_actor.auth_id, 'email', owner_actor.email, 'role', 'authenticated'
  )::text, true);
  update_result := public.update_workflow_instance_draft(
    draft_id,
    'Updated draft title',
    jsonb_build_object('note', 'updated draft note'),
    array[assignee_actor.actor_id],
    gen_random_uuid()
  );
  if update_result #>> '{instance,title}' <> 'Updated draft title'
     or update_result #>> '{instance,form_data,note}' <> 'updated draft note' then
    raise exception 'Owner could not update own draft';
  end if;

  submit_result := public.submit_workflow_instance_draft(
    draft_id, array[assignee_actor.actor_id], gen_random_uuid()
  );
  if submit_result #>> '{instance,status}' <> 'RUNNING'
     or submit_result #>> '{instance,current_node_id}' <> context.action_node_id::text
     or submit_result #>> '{log,action}' <> 'SUBMITTED'
     or submit_result #>> '{log,acted_by}' <> owner_actor.actor_id::text then
    raise exception 'Owner could not atomically submit own draft';
  end if;

  blocked := false;
  begin
    perform public.update_workflow_instance_draft(
      draft_id, 'Cannot edit running', null, null, gen_random_uuid()
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'WORKFLOW_COMMAND_FORBIDDEN';
  end;
  if not blocked then raise exception 'Submitted draft remained editable as draft'; end if;

  create_result := public.create_workflow_instance_draft(
    jsonb_build_object(
      'templateId', context.template_id,
      'title', 'Draft to delete',
      'formData', '{}'::jsonb,
      'initialAssigneeUserIds', '[]'::jsonb
    ),
    gen_random_uuid()
  );
  delete_draft_id := (create_result #>> '{instance,id}')::uuid;
  delete_result := public.delete_workflow_instance_draft(
    delete_draft_id, gen_random_uuid()
  );
  if delete_result ->> 'deletedInstanceId' <> delete_draft_id::text
     or exists (
       select 1 from public.workflow_instances where id = delete_draft_id
     ) then
    raise exception 'Owner could not delete own draft';
  end if;
end;
$$;

reset role;

select 'authorization_v2_task12_4_2_workflow_draft_lifecycle_smoke_passed' as result;
rollback;
