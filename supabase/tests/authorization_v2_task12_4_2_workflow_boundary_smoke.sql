-- Workflow boundary hardening smoke. Everything is rolled back.
begin;

create temporary table e32_actor(
  kind text primary key,
  id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into e32_actor
select kind, gen_random_uuid(), gen_random_uuid(),
       'e32-workflow-' || kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('owner'), ('assignee'), ('template_user'), ('template_admin'), ('outsider')) actor(kind);

insert into public.users(id, name, email, username, role, is_active, account_status)
select id, 'E32 Workflow ' || kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from e32_actor;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, is_active, grant_reason)
select actor.id, grants.permission_code, grants.scope_type,
       case when grants.scope_type in ('own', 'assigned') then actor.id::text else grants.scope_id end,
       true, 'E32 rollback smoke'
from e32_actor actor
join (values
  ('owner', 'workflow.instance.view', 'own', '*'),
  ('owner', 'workflow.instance.create', 'own', '*'),
  ('assignee', 'workflow.instance.view', 'assigned', '*'),
  ('assignee', 'workflow.instance.act_assigned', 'assigned', '*'),
  ('template_user', 'workflow.template.view', 'global', '*'),
  ('template_admin', 'workflow.template.view', 'global', '*'),
  ('template_admin', 'workflow.template.create', 'global', '*'),
  ('template_admin', 'workflow.template.edit', 'global', '*'),
  ('template_admin', 'workflow.template.publish', 'global', '*')
) grants(actor_kind, permission_code, scope_type, scope_id) on grants.actor_kind = actor.kind;

create temporary table e32_workflow_fixture(
  template_id uuid,
  start_node_id uuid,
  task_node_id uuid,
  end_node_id uuid,
  instance_id uuid
) on commit drop;

insert into e32_workflow_fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into public.workflow_templates(id, name, description, created_by, is_active, custom_fields, managers, default_watchers)
select f.template_id, 'E32 Workflow Template', 'rollback smoke', owner.id, true, '[]'::jsonb, '{}'::text[], '{}'::text[]
from e32_workflow_fixture f cross join e32_actor owner where owner.kind = 'owner';

insert into public.workflow_nodes(id, template_id, type, label, config)
select node_id, f.template_id, node_type::public.workflow_node_type, label, '{}'::jsonb
from e32_workflow_fixture f
cross join lateral (values
  (f.start_node_id, 'START', 'Start'),
  (f.task_node_id, 'APPROVAL', 'Approve'),
  (f.end_node_id, 'END', 'End')
) nodes(node_id, node_type, label);

insert into public.workflow_edges(id, template_id, source_node_id, target_node_id, label)
select gen_random_uuid(), f.template_id, source_id, target_id, ''
from e32_workflow_fixture f
cross join lateral (values
  (f.start_node_id, f.task_node_id),
  (f.task_node_id, f.end_node_id)
) edges(source_id, target_id);

insert into public.workflow_instances(
  id, template_id, code, title, created_by, current_node_id, status,
  form_data, watchers, step_assignees
)
select f.instance_id, f.template_id, 'E32-' || left(f.instance_id::text, 8),
       'E32 generic instance', owner.id, f.task_node_id, 'RUNNING', '{}', '{}',
       jsonb_build_object(f.task_node_id::text, jsonb_build_array(assignee.id::text))
from e32_workflow_fixture f
join e32_actor owner on owner.kind = 'owner'
join e32_actor assignee on assignee.kind = 'assignee';

grant select on e32_actor, e32_workflow_fixture to authenticated;

set local role authenticated;

do $$
declare
  actor_row e32_actor%rowtype;
  fixture_row e32_workflow_fixture%rowtype;
  blocked boolean;
  result jsonb;
  visible_count integer;
begin
  select * into fixture_row from e32_workflow_fixture;

  select * into actor_row from e32_actor where kind = 'owner';
  perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
  perform set_config('request.jwt.claim.email', actor_row.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_row.auth_id, 'email', actor_row.email, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.workflow_instances where id = fixture_row.instance_id;
  if visible_count <> 1 then
    raise exception 'E32 owner view capability did not expose own instance: actor=%, grant=%, helper=%',
      public.current_app_user_id(),
      app_private.has_permission(actor_row.id, 'workflow.instance.view', 'own', actor_row.id::text),
      app_private.workflow_instance_actor_can_select(fixture_row.instance_id);
  end if;

  select * into actor_row from e32_actor where kind = 'outsider';
  perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
  perform set_config('request.jwt.claim.email', actor_row.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_row.auth_id, 'email', actor_row.email, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.workflow_instances where id = fixture_row.instance_id;
  if visible_count <> 0 then
    raise exception 'E32 outsider viewed generic instance without capability: actor=%, owner-grant=%, direct=%, helper=%',
      public.current_app_user_id(),
      app_private.has_permission(actor_row.id, 'workflow.instance.view', 'own', actor_row.id::text),
      app_private.has_permission(actor_row.id, 'workflow.instance.view', 'global', '*'),
      app_private.workflow_instance_actor_can_select(fixture_row.instance_id);
  end if;

  select * into actor_row from e32_actor where kind = 'assignee';
  perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
  perform set_config('request.jwt.claim.email', actor_row.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_row.auth_id, 'email', actor_row.email, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.workflow_instances where id = fixture_row.instance_id;
  if visible_count <> 1 then raise exception 'E32 assigned viewer did not see assigned instance'; end if;
  select to_jsonb(processed_row) into result
  from public.process_workflow_instance_fast(
    fixture_row.instance_id, 'APPROVED'::public.workflow_instance_action,
    actor_row.id, 'E32 assigned approval', null::uuid[]
  ) processed_row;
  if result is null then raise exception 'E32 assigned process returned no result'; end if;

  select * into actor_row from e32_actor where kind = 'template_user';
  perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
  perform set_config('request.jwt.claim.email', actor_row.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_row.auth_id, 'email', actor_row.email, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.workflow_templates where id = fixture_row.template_id;
  if visible_count <> 1 then raise exception 'E32 template user could not view template'; end if;
  blocked := false;
  begin
    perform public.create_workflow_template('E32 forbidden', '', gen_random_uuid());
  exception when sqlstate '42501' then blocked := true;
  end;
  if not blocked then raise exception 'E32 template user created template without create capability'; end if;

  select * into actor_row from e32_actor where kind = 'template_admin';
  perform set_config('request.jwt.claim.sub', actor_row.auth_id::text, true);
  perform set_config('request.jwt.claim.email', actor_row.email, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_row.auth_id, 'email', actor_row.email, 'role', 'authenticated')::text, true);
  result := public.create_workflow_template('E32 command template', 'created by command', gen_random_uuid());
  if coalesce(result #>> '{template,name}', '') <> 'E32 command template' then raise exception 'E32 template create RPC failed'; end if;
  result := public.update_workflow_template_metadata(
    (result #>> '{template,id}')::uuid, 'E32 edited template', 'edited', '[]'::jsonb, '{}'::text[], '{}'::text[], gen_random_uuid()
  );
  if coalesce(result #>> '{template,name}', '') <> 'E32 edited template' then raise exception 'E32 template edit RPC failed'; end if;
  result := public.publish_workflow_template((result #>> '{template,id}')::uuid, false, gen_random_uuid());
  if coalesce((result #>> '{template,is_active}')::boolean, true) then raise exception 'E32 publish RPC failed'; end if;

  blocked := false;
  begin
    insert into public.workflow_templates(name, created_by, is_active) values ('E32 direct bypass', actor_row.id, true);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E32 direct template insert bypassed command boundary'; end if;

  blocked := false;
  begin
    update public.workflow_nodes set label = 'E32 direct bypass' where id = fixture_row.task_node_id;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E32 direct node update bypassed command boundary'; end if;
end;
$$;

select jsonb_build_object(
  'status', 'ok',
  'enforcedActions', (
    select count(*) from public.permission_actions
    where permission_code in ('workflow.instance.view','workflow.instance.create','workflow.instance.act_assigned',
      'workflow.template.view','workflow.template.create','workflow.template.edit','workflow.template.publish')
      and grant_readiness in ('enforced','verified')
  )
);

rollback;
